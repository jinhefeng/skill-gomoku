const GomokuEngine = require('./games/gomoku/engine');

class RoomLifecycleManager {
    constructor(io) {
        this.io = io;
        this.rooms = {}; // roomId -> { roomId, isPrivate, players: [...], engine, state: 'LOBBY' }
        this.queue = [];
    }

    broadcastLobbyState(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.state !== 'LOBBY') return;
        this.io.to(roomId).emit('lobby_selections', {
            selections: room.selections || {}, 
            gameConfigs: room.gameConfigs || {}
        });
    }

    joinRandom(socket, nickname) {
        // 防抖：如果在排队中，直接忽略
        if (this.queue.includes(socket.id)) return;

        // 优先寻找大厅阶段只有1人且非私密的房间
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            if (!room.isPrivate && room.state === 'LOBBY' && room.players.length === 1) {
                // 修复：不能匹配到自己所在的房间
                if (room.players[0].socket.id === socket.id) {
                    continue;
                }
                this.addPlayerToRoom(roomId, socket, nickname);
                return;
            }
        }

        if (this.queue.length > 0) {
            const opponentId = this.queue.shift();
            // 兜底：如果碰巧排到了自己，继续取下一个
            if (opponentId === socket.id) {
                return this.joinRandom(socket, nickname);
            }
            const opponentSocket = this.io.sockets.sockets.get(opponentId);
            if (!opponentSocket) {
                return this.joinRandom(socket, nickname);
            }

            // 增强：确保随机房号不与私密房号冲突，且明确为非私密
            const roomId = `match_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            this.createRoom(roomId, false);
            
            this.addPlayerToRoom(roomId, opponentSocket, opponentSocket.nickname || 'Opponent');
            this.addPlayerToRoom(roomId, socket, nickname);
        } else {
            socket.nickname = nickname;
            if (!this.queue.includes(socket.id)) {
                this.queue.push(socket.id);
            }
            socket.emit('waiting_for_match');
        }
    }

    leaveQueue(socketId) {
        this.queue = this.queue.filter(id => id !== socketId);
    }

    createPrivate(socket, nickname) {
        let roomId;
        let attempts = 0;
        // 生成 6 位唯一房号
        do {
            roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
            attempts++;
        } while (this.rooms[roomId] && attempts < 10);

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
            gameConfigs: {
                sudoku: { difficulty: 'medium', smartAssist: false, owner: null },
                gomoku: { skillEnabled: true, owner: null }
            },
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

        // 补发当前大厅选择状态（给新加入者同步已选项目）
        this.broadcastLobbyState(roomId);

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

                    // 剩余玩家置灰且进入匹配队列（或者等待）
                    this.io.to(roomId).emit('opponent_offline', { 
                        message: `对方 (${leavingPlayer.nickname}) 已退出游戏`,
                        playerNum: leavingPlayer.pIdx,
                        scores: room.persistedScores
                    });
                } else if (room.state === 'LOBBY') {
                    // 大厅阶段如果对方离开，通知剩余玩家并重置状态
                    room.selections = {};
                    room.gameConfigs.sudoku.owner = null;
                    room.gameConfigs.gomoku.owner = null;
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
            
            const gameId = data.gameId;
            const config = room.gameConfigs[gameId];

            // 1. 获取配置所有权 (First-to-Select)
            if (config && config.owner === null) {
                config.owner = p.pIdx;
            }

            // 只有当玩家明确切换到另一个不同游戏时，才释放原有游戏的所有权
            if (room.selections[p.pIdx] !== gameId) {
                Object.keys(room.gameConfigs).forEach(gId => {
                    if (gId !== gameId && room.gameConfigs[gId].owner === p.pIdx) {
                        room.gameConfigs[gId].owner = null;
                    }
                });
                room.selections[p.pIdx] = gameId;
            }

            // 3. 应用配置修改 (仅限 Owner)
            if (config && config.owner === p.pIdx) {
                if (gameId === 'sudoku') {
                    if (data.difficulty) config.difficulty = data.difficulty;
                    if (data.smartAssist !== undefined) config.smartAssist = data.smartAssist;
                } else if (gameId === 'gomoku') {
                    if (data.skillEnabled !== undefined) config.skillEnabled = data.skillEnabled;
                }
                this.broadcastLobbyState(roomId);
            } else if (config && config.owner !== p.pIdx && (data.difficulty || data.smartAssist !== undefined || data.skillEnabled !== undefined)) {
                // 如果非 Owner 尝试修改，强行给该客户端补发一次正确状态同步
                socket.emit('lobby_selections', {
                    selections: room.selections || {}, 
                    gameConfigs: room.gameConfigs || {}
                });
            } else {
                // 仅选择游戏的情况
                this.broadcastLobbyState(roomId);
            }
            
            // Check if both match
            if (room.players.length === 2 && room.selections[1] && room.selections[1] === room.selections[2]) {
                const chosenGame = room.selections[1];
                const gameConfig = room.gameConfigs[chosenGame] || {};
                
                const difficulty = gameConfig.difficulty || 'medium';
                const smartAssist = gameConfig.smartAssist || false;
                const skillEnabled = gameConfig.skillEnabled !== undefined ? gameConfig.skillEnabled : true;
                
                // 重置大厅核心状态 (属性保留，所有者置空)
                room.selections = {};
                room.gameConfigs.sudoku.owner = null;
                room.gameConfigs.gomoku.owner = null;
                
                room.state = 'INGAME';
                this.mountEngine(roomId, chosenGame, difficulty, smartAssist, skillEnabled);
            }
        } else if (event === 'request_start_game') {
            socket.to(roomId).emit('game_proposal_received', data);
        } else if (event === 'agree_start_game') {
            if (room.state !== 'INGAME') {
                const gameId = data.gameId;
                const config = room.gameConfigs[gameId] || {};
                room.state = 'INGAME';
                this.mountEngine(roomId, gameId, config.difficulty, config.smartAssist, config.skillEnabled);
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
                // 状态机转换：切换到大厅并执行一次性重置
                room.state = 'LOBBY';
                room.selections = {};
                room.gameConfigs.sudoku.owner = null;
                room.gameConfigs.gomoku.owner = null;
                
                const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
                socket.emit('returned_to_lobby', { message: '您已返回大厅', players: playersData });
                this.broadcastLobbyState(roomId);
            } else if (room.state === 'LOBBY') {
                // 已经在 LOBBY 态（例如另一名玩家已经先回来并占用了配置权），此时只需同步玩家列表和广播现有状态
                const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
                socket.emit('returned_to_lobby', { players: playersData });
                this.broadcastLobbyState(roomId);
            }
        }
    }

    mountEngine(roomId, gameId, difficulty, smartAssist, skillEnabled) {
        const room = this.rooms[roomId];
        if (!room) return;
        const context = this.createContext(roomId);
        if (gameId === 'gomoku') {
            const GomokuEngine = require('./games/gomoku/engine');
            room.engine = new GomokuEngine(roomId, context, { skillEnabled });
        } else if (gameId === 'sudoku') {
            const EngineClass = require('./games/sudoku/engine');
            room.engine = new EngineClass(roomId, context, { difficulty: difficulty || 'medium', smartAssist: smartAssist || false });
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
