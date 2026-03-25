const GomokuEngine = require('./games/gomoku/engine');

class RoomLifecycleManager {
    constructor(io) {
        this.io = io;
        this.rooms = {}; // roomId -> { roomId, isPrivate, players: [...], engine, state: 'LOBBY' }
        this.queue = [];
    }

    joinRandom(socket, nickname) {
        if (this.queue.length > 0) {
            const opponentId = this.queue.shift();
            const opponentSocket = this.io.sockets.sockets.get(opponentId);
            if (!opponentSocket) {
                // If opponent disconnected asynchronously
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
            engine: null
        };
    }

    addPlayerToRoom(roomId, socket, nickname) {
        const room = this.rooms[roomId];
        if (!room) return;

        socket.join(roomId);
        const pIdx = room.players.length === 0 ? 1 : 2;
        room.players.push({ id: socket.id, socket, nickname, pIdx });

        if (room.players.length === 2) {
            const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
            room.players.forEach(p => {
                this.io.to(p.id).emit('room_joined_lobby', { 
                    roomId: roomId, 
                    myPlayerNum: p.pIdx, 
                    players: playersData 
                });
            });
        }
    }

    handleDisconnect(socketId) {
        this.leaveQueue(socketId);
        
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            const playerIdx = room.players.findIndex(p => p.socket.id === socketId);
            if (playerIdx !== -1) {
                if (room.engine) room.engine.removePlayer(socketId);
                room.players.splice(playerIdx, 1);
                
                if (room.players.length === 0) {
                    this.destroyRoom(roomId);
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
            this.io.to(roomId).emit('lobby_selections', room.selections);
            
            // Check if both match
            if (room.players.length === 2 && room.selections[1] && room.selections[1] === room.selections[2]) {
                const chosenGame = room.selections[1];
                room.selections = {};
                room.state = 'INGAME';
                this.mountEngine(roomId, chosenGame);
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
                const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
                socket.emit('returned_to_lobby', { message: '您已返回大厅', players: playersData });
            } else if (room.state === 'LOBBY') {
                room.selections = {};
                const playersData = room.players.map(p => ({ id: p.id, nickname: p.nickname, playerNum: p.pIdx }));
                socket.emit('returned_to_lobby', { players: playersData });
            }
        }
    }

    mountEngine(roomId, gameId) {
        const room = this.rooms[roomId];
        if (!room) return;

        const context = this.createContext(roomId);
        if (gameId === 'gomoku') {
            const GomokuEngine = require('./games/gomoku/engine');
            room.engine = new GomokuEngine(roomId, context);
        } else if (gameId === 'sudoku') {
            const EngineClass = require('./games/sudoku/engine') || GomokuEngine; // Fallback for placeholder
            room.engine = new EngineClass(roomId, context);
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
        return {
            broadcast: (event, data) => {
                this.io.to(roomId).emit(event, data);
            },
            emitTo: (socketId, event, data) => {
                this.io.to(socketId).emit(event, data);
            }
        };
    }
}

module.exports = RoomLifecycleManager;
