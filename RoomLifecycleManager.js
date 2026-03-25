const GomokuEngine = require('./games/gomoku/engine');

class RoomLifecycleManager {
    constructor(io) {
        this.io = io;
        this.rooms = {}; // roomId -> { roomId, isPrivate, players: [...], engine, state: 'LOBBY' }
        this.queue = [];
    }

    joinRandom(socket, nickname) {
        // 优先寻找大厅阶段只有1人且非私密的房间
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            if (!room.isPrivate && room.state === 'LOBBY' && room.players.length === 1) {
                this.addPlayerToRoom(roomId, socket, nickname);
                return;
            }
        }

        if (this.queue.length > 0) {
            const opponentId = this.queue.shift();
            const opponentSocket = this.io.sockets.sockets.get(opponentId);
            if (!opponentSocket) {
                return this.joinRandom(socket, nickname);
            }

            const roomId = `room_${Date.now()}`;
            this.createRoom(roomId, false);
            
            this.addPlayerToRoom(roomId, opponentSocket, opponentSocket.nickname || 'Opponent');
            this.addPlayerToRoom(roomId, socket, nickname);
        } else {
            socket.nickname = nickname;
            this.queue.push(socket.id);
            socket.emit('waiting_for_match');
        }
    }

    leaveQueue(socketId) {
        this.queue = this.queue.filter(id => id !== socketId);
    }

    createPrivate(socket, nickname) {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.createRoom(roomId, true);
        this.addPlayerToRoom(roomId, socket, nickname);
        socket.emit('room_created', roomId);
    }

    joinPrivate(socket, roomId, nickname) {
        const room = this.rooms[roomId];
        if (room && room.isPrivate && room.players.length < 2) {
            this.addPlayerToRoom(roomId, socket, nickname);
        } else {
            socket.emit('error_message', '房间不存在或已满');
        }
    }

    createRoom(roomId, isPrivate) {
        this.rooms[roomId] = {
            roomId,
            isPrivate,
            state: 'LOBBY',
            players: [],
            selections: {},
            engine: null,
            persistedScores: { 1: 0, 2: 0 },
            lastPlayerNames: { 1: null, 2: null }
        };
    }

    addPlayerToRoom(roomId, socket, nickname) {
        const room = this.rooms[roomId];
        if (!room) return;

        socket.join(roomId);
        // 找到可用的 playerNum (1 或 2)
        const occupiedIdxs = room.players.map(p => p.pIdx);
        const pIdx = occupiedIdxs.includes(1) ? 2 : 1;
        
        // 逻辑：如果新进入者的昵称与占据此位置的前一玩家不同，清空双方积分为 0
        if (room.lastPlayerNames[pIdx] && room.lastPlayerNames[pIdx] !== nickname) {
            room.persistedScores = { 1: 0, 2: 0 };
        }
        
        room.lastPlayerNames[pIdx] = nickname;
        room.players.push({ id: socket.id, socket, nickname, pIdx });

        // 无论几人，通知自己已进入大厅（包含当前积分）
        const playersData = room.players.map(p => ({ 
            id: p.id, 
            nickname: p.nickname, 
            playerNum: p.pIdx 
        }));
        
        socket.emit('room_joined_lobby', { 
            roomId: roomId, 
            myPlayerNum: pIdx, 
            players: playersData,
            scores: room.persistedScores,
            opponentName: room.lastPlayerNames[pIdx === 1 ? 2 : 1]
        });

        // 如果是第2个人进入，也要通知第1个人
        if (room.players.length === 2) {
            const opponent = room.players.find(p => p.pIdx !== pIdx);
            if (opponent) {
                opponent.socket.emit('room_joined_lobby', {
                    roomId: roomId,
                    myPlayerNum: opponent.pIdx,
                    players: playersData,
                    scores: room.persistedScores,
                    opponentName: nickname
                });
            }
        }
    }
    handleDisconnect(socketId) {
        this.leaveQueue(socketId);
        
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            const playerIdx = room.players.findIndex(p => p.socket.id === socketId);
            if (playerIdx !== -1) {
                const leavingPlayer = room.players[playerIdx];
                room.players.splice(playerIdx, 1);
                
                if (room.players.length === 0) {
                    this.destroyRoom(roomId);
                } else if (room.state === 'INGAME') {
                    // 游戏进行中如果离开，通知对手游戏结束
                    const opponent = room.players.find(p => p.socket.id !== socketId);
                    if (opponent && room.engine) {
                        this.io.to(opponent.id).emit('game_over', { 
                            winner: opponent.pIdx, 
                            score: room.engine.score || room.persistedScores, 
                            onlyReturnLobby: true 
                        });
                        room.engine.destroy();
                        room.engine = null;
                    }
                    room.state = 'LOBBY';
                    room.selections = {};
                    room.sudokuDifficulty = null;
                    room.sudokuDifficultyOwner = null;

                    // 剩余玩家置灰且进入匹配队列（或者等待）
                    this.io.to(roomId).emit('opponent_offline', { 
                        message: `对方 (${leavingPlayer.nickname}) 已退出游戏`,
                        playerNum: leavingPlayer.pIdx,
                        scores: room.persistedScores
                    });
                } else if (room.state === 'LOBBY') {
                    // 大厅阶段如果对方离开，通知剩余玩家并重置状态
                    room.selections = {};
                    room.sudokuDifficulty = null;
                    room.sudokuDifficultyOwner = null;
                    this.io.to(roomId).emit('opponent_offline', { 
                        message: `对方 (${leavingPlayer.nickname}) 已退出大厅`,
                        playerNum: leavingPlayer.pIdx,
                        scores: room.persistedScores
                    });
                }
                break;
            }
        }
    }

    handleLeaveRoom(socket, roomId) {
        const room = this.rooms[roomId];
        if (room) {
            const playerIdx = room.players.findIndex(p => p.socket.id === socket.id);
            if (playerIdx !== -1) {
                if (room.engine) room.engine.removePlayer(socket.id);
                room.players.splice(playerIdx, 1);
                socket.leave(roomId);

                if (room.players.length === 0) {
                    this.destroyRoom(roomId);
                } else {
                    socket.to(roomId).emit('opponent_left');
                }
            }
        }
    }

    handleEvent(socket, roomId, event, data) {
        const room = this.rooms[roomId];
        if (room && room.engine && room.state === 'INGAME') {
            room.engine.handleEvent(socket.id, event, data);
        }
    }

    handleLobbyEvent(socket, roomId, event, data) {
        const room = this.rooms[roomId];
        if (!room) return;

        if (event === 'player_select_game') {
            if (room.state !== 'LOBBY') return;
            const p = room.players.find(p => p.socket.id === socket.id);
            if (!p) return;
            
            room.selections[p.pIdx] = data.gameId;
            
            // 数独难度：首位选中 sudoku 的玩家可设定/更新 difficulty，后选者不可覆盖
            if (data.gameId === 'sudoku' && data.difficulty) {
                if (!room.sudokuDifficultyOwner || room.sudokuDifficultyOwner === p.pIdx) {
                    room.sudokuDifficulty = data.difficulty;
                    room.sudokuDifficultyOwner = p.pIdx;
                }
            }
            this.io.to(roomId).emit('lobby_selections', room.selections, room.sudokuDifficulty || null);
            
            // Check if both match
            if (room.players.length === 2 && room.selections[1] && room.selections[1] === room.selections[2]) {
                const chosenGame = room.selections[1];
                const difficulty = room.sudokuDifficulty || 'medium';
                room.selections = {};
                room.sudokuDifficulty = null;
                room.sudokuDifficultyOwner = null;
                room.state = 'INGAME';
                this.mountEngine(roomId, chosenGame, difficulty);
            }
        } else if (event === 'request_start_game') {
            socket.to(roomId).emit('game_proposal_received', data);
        } else if (event === 'agree_start_game') {
            if (room.state !== 'INGAME') {
                room.state = 'INGAME';
                this.mountEngine(roomId, data.gameId);
            }
        } else if (event === 'leave_game_to_lobby') {
            if (room.state === 'INGAME') {
                if (room.engine) {
                    const opponent = room.players.find(p => p.socket.id !== socket.id);
                    if (opponent) {
                        this.io.to(opponent.id).emit('game_over', { 
                            winner: opponent.pIdx, 
                            score: room.engine.score || {1:0, 2:0}, 
                            onlyReturnLobby: true 
                        });
                    }
                    room.engine.destroy();
                    room.engine = null;
                }
                room.state = 'LOBBY';
                room.selections = {};
                room.sudokuDifficulty = null;
                room.sudokuDifficultyOwner = null;
                const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
                socket.emit('returned_to_lobby', { message: '您已返回大厅', players: playersData });
            } else if (room.state === 'LOBBY') {
                room.selections = {};
                room.sudokuDifficulty = null;
                room.sudokuDifficultyOwner = null;
                const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
                socket.emit('returned_to_lobby', { players: playersData });
            }
        }
    }

    mountEngine(roomId, gameId, difficulty) {
        const room = this.rooms[roomId];
        if (!room) return;

        const context = this.createContext(roomId);
        if (gameId === 'gomoku') {
            const GomokuEngine = require('./games/gomoku/engine');
            room.engine = new GomokuEngine(roomId, context);
        } else if (gameId === 'sudoku') {
            const EngineClass = require('./games/sudoku/engine');
            room.engine = new EngineClass(roomId, context);
            room.engine.difficulty = difficulty || 'medium';
        }
        
        if(room.engine.init) room.engine.init();
        room.players.forEach(p => room.engine.addPlayer(p.id, p.nickname));
    }

    destroyRoom(roomId) {
        const room = this.rooms[roomId];
        if (room) {
            if (room.engine) room.engine.destroy();
            delete this.rooms[roomId];
        }
    }

    createContext(roomId) {
        const room = this.rooms[roomId];
        return {
            broadcast: (event, data) => {
                // 如果是游戏结束，持久化分数
                if (event === 'game_over' && data.score && room) {
                    room.persistedScores = data.score;
                }
                this.io.to(roomId).emit(event, data);
            },
            emitTo: (socketId, event, data) => {
                this.io.to(socketId).emit(event, data);
            }
        };
    }
}

module.exports = RoomLifecycleManager;
