const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(__dirname));

// Game State
const TURN_DURATION = 30; // Seconds
const rooms = {}; // { roomId: { players: [socketId, ...], board: [], turn: 1, ... } }
const queue = []; // [socketId, ...]

// Stats file path
const STATS_FILE = path.join(__dirname, 'stats.json');

// Global Stats
let onlineCount = 0;
let totalVisits = 0;
let visitHistory = []; // [{ time: 'HH:00', count: 123 }, ...]

// Load stats from file if exists
function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
            totalVisits = data.totalVisits || 0;
            visitHistory = data.visitHistory || [];
            console.log('Stats loaded:', { totalVisits, historyLength: visitHistory.length });
        } else {
            // Initialize visit history for the last 24 hours
            for (let i = 0; i < 24; i++) {
                const d = new Date();
                d.setHours(d.getHours() - i);
                visitHistory.unshift({ time: `${d.getHours()}:00`, count: 0 });
            }
        }
    } catch (err) {
        console.error('Error loading stats:', err);
        // Initialize with empty data
        for (let i = 0; i < 24; i++) {
            const d = new Date();
            d.setHours(d.getHours() - i);
            visitHistory.unshift({ time: `${d.getHours()}:00`, count: 0 });
        }
    }
}

// Save stats to file
function saveStats() {
    try {
        const data = {
            totalVisits,
            visitHistory,
            lastUpdate: new Date().toISOString()
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Error saving stats:', err);
    }
}

// Load stats on startup
loadStats();

function updateStats() {
    io.emit('stats_update', {
        onlineCount,
        totalVisits,
        visitHistory
    });
    // Save stats whenever they are updated
    saveStats();
}

// Track visits hourly
setInterval(() => {
    const currentHour = `${new Date().getHours()}:00`;
    const lastEntry = visitHistory[visitHistory.length - 1];

    if (lastEntry.time !== currentHour) {
        visitHistory.shift();
        visitHistory.push({ time: currentHour, count: totalVisits });
    } else {
        lastEntry.count = totalVisits;
    }
    updateStats();
}, 60000); // Check every minute

// Helper function to check if coordinates are valid
function isValid(x, y, boardSize = 15) {
    return x >= 0 && x < boardSize && y >= 0 && y < boardSize;
}

// Check win condition (5 in a row)
function checkWin(board, y, x, player) {
    const directions = [
        [1, 0],   // horizontal
        [0, 1],   // vertical
        [1, 1],   // diagonal \
        [1, -1]   // diagonal /
    ];

    for (let [dx, dy] of directions) {
        let count = 1;
        // Check positive direction
        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            if (isValid(nx, ny) && board[ny][nx] === player) count++;
            else break;
        }
        // Check negative direction
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i;
            const ny = y - dy * i;
            if (isValid(nx, ny) && board[ny][nx] === player) count++;
            else break;
        }
        if (count >= 5) return true;
    }
    return false;
}

io.on('connection', (socket) => {
    onlineCount++;
    totalVisits++;
    // Update current hour count immediately
    visitHistory[visitHistory.length - 1].count = totalVisits;
    updateStats();

    console.log('A user connected:', socket.id);

    // Send initial stats
    socket.emit('stats_update', {
        onlineCount,
        totalVisits,
        visitHistory
    });

    socket.on('get_stats', () => {
        socket.emit('stats_update', {
            onlineCount,
            totalVisits,
            visitHistory
        });
    });

    // Random Matchmaking
    socket.on('join_random', (nickname) => {
        socket.nickname = nickname || 'Unknown';
        if (queue.length > 0) {
            const opponentId = queue.shift();
            const roomId = `room_${Date.now()}`;

            // Create Room with full state
            rooms[roomId] = {
                players: [
                    { id: opponentId, nickname: io.sockets.sockets.get(opponentId)?.nickname || 'Opponent', player: 1 },
                    { id: socket.id, nickname, player: 2 }
                ],
                board: Array(15).fill().map(() => Array(15).fill(0)),
                currentTurn: Math.random() < 0.5 ? 1 : 2, // Random Start
                gameActive: true,
                isPrivate: false,
                timer: null,
                timerStart: null,
                score: { 1: 0, 2: 0 },
                energy: { 1: 0, 2: 0 },
                doubleMoveRemaining: 0,
                blockedSpots: [], // [{x, y, duration}]
                restartRequests: new Set()
            };

            const room = rooms[roomId];
            const p1 = room.players[0];
            const p2 = room.players[1];

            socket.join(roomId);
            const opponentSocket = io.sockets.sockets.get(opponentId);
            if (opponentSocket) opponentSocket.join(roomId);

            // Notify both
            io.to(p1.id).emit('game_start', {
                roomId,
                player: 1,
                opponentNickname: p2.nickname,
                currentTurn: room.currentTurn,
                score: room.score
            });

            io.to(p2.id).emit('game_start', {
                roomId,
                player: 2,
                opponentNickname: p1.nickname,
                currentTurn: room.currentTurn,
                score: room.score
            });

            startTurnTimer(roomId, room.currentTurn);
        } else {
            queue.push(socket.id);
            // Find available room
            let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1 && !rooms[id].isPrivate);

            if (!roomId) {
                roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
                rooms[roomId] = {
                    players: [{ id: socket.id, nickname, player: 1 }],
                    board: Array(15).fill().map(() => Array(15).fill(0)),
                    currentTurn: Math.random() < 0.5 ? 1 : 2, // Random Start
                    gameActive: false,
                    isPrivate: false,
                    timer: null,
                    timerStart: null,
                    score: { 1: 0, 2: 0 },
                    score: { 1: 0, 2: 0 },
                    energy: { 1: 0, 2: 0 },
                    blockedSpots: []
                };
                socket.join(roomId);
                socket.emit('waiting_for_match');
            } else {
                const room = rooms[roomId];
                room.players.push({ id: socket.id, nickname, player: 2 });
                socket.join(roomId);
                room.gameActive = true;

                // Notify both
                room.players.forEach(p => {
                    io.to(p.id).emit('game_start', {
                        roomId,
                        player: p.player,
                        opponentNickname: room.players.find(op => op.id !== p.id).nickname,
                        currentTurn: room.currentTurn,
                        score: room.score
                    });
                });

                startTurnTimer(roomId);
            }
        }
    });

    // Create Private Room
    socket.on('create_private', (nickname) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            players: [{ id: socket.id, nickname, player: 1 }],
            board: Array(15).fill().map(() => Array(15).fill(0)),
            currentTurn: Math.random() < 0.5 ? 1 : 2, // Random Start
            gameActive: false,
            timer: null,
            timerStart: null,
            score: { 1: 0, 2: 0 }, // Score Tracking
            energy: { 1: 0, 2: 0 }, // Energy Tracking
            blockedSpots: [],
            doubleMoveRemaining: 0,
            restartRequests: new Set()
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
    });

    // Join Private Room
    socket.on('join_private', (data) => {
        // data: { roomId, nickname }
        const { roomId, nickname } = data;
        const room = rooms[roomId];

        if (room && room.players.length < 2) {
            room.players.push({ id: socket.id, nickname, player: 2 });
            socket.join(roomId);
            room.gameActive = true;

            // Notify both players
            io.to(roomId).emit('game_start', {
                roomId,
                players: room.players,
                currentTurn: room.currentTurn,
                score: room.score
            });

            // Send specific info to each
            room.players.forEach(p => {
                io.to(p.id).emit('game_start', {
                    roomId,
                    player: p.player,
                    opponentNickname: room.players.find(op => op.id !== p.id).nickname,
                    currentTurn: room.currentTurn,
                    score: room.score
                });
            });

            startTurnTimer(roomId);
        } else {
            socket.emit('error_message', '房间不存在或已满');
        }
    });

    // Game Events
    socket.on('game_move', (data) => {
        const room = rooms[data.roomId];
        if (room && room.gameActive && data.player === room.currentTurn) {
            const { x, y } = data;

            // Validate Coordinates
            if (!isValid(x, y)) return;

            // Check Blocked Spots
            if (room.blockedSpots.some(s => s.x === x && s.y === y)) {
                socket.emit('error_message', '该位置已被破坏，暂时无法落子');
                return;
            }

            if (room.board[y][x] === 0) {
                room.board[y][x] = data.player;

                // Check Win
                if (checkWin(room.board, y, x, data.player)) {
                    room.gameActive = false;
                    clearTurnTimer(data.roomId);
                    room.score[data.player]++;
                    socket.to(data.roomId).emit('opponent_move', data);
                    io.to(data.roomId).emit('game_over', {
                        winner: data.player,
                        score: room.score
                    });
                } else {
                    // Handle Double Move
                    if (room.doubleMoveRemaining > 0) {
                        room.doubleMoveRemaining--;
                        socket.to(data.roomId).emit('opponent_move', data);

                        // If moves ran out, switch turn
                        if (room.doubleMoveRemaining === 0) {
                            room.currentTurn = room.currentTurn === 1 ? 2 : 1;
                            startTurnTimer(data.roomId);
                        } else {
                            // Still has moves, restart timer for same player
                            startTurnTimer(data.roomId, false); // No energy regen for double move continuation
                        }
                    } else {
                        room.currentTurn = room.currentTurn === 1 ? 2 : 1;
                        socket.to(data.roomId).emit('opponent_move', data);
                        startTurnTimer(data.roomId);
                    }
                }
            }
        }
    });

    socket.on('game_skill', (data) => {
        const room = rooms[data.roomId];
        if (room && room.gameActive && data.player === room.currentTurn) {
            const playerEnergy = room.energy[data.player];
            let cost = 0;
            if (data.skill === 'double') cost = 4;
            else if (data.skill === 'rebel') cost = 3;
            else if (data.skill === 'destroy') cost = 2;

            // Validate Energy
            if (playerEnergy < cost) return;

            // Deduct Energy
            room.energy[data.player] -= cost;

            // Update board if needed
            if (data.skill === 'destroy') {
                if (!isValid(data.x, data.y)) return;
                room.board[data.y][data.x] = 0;
                // Block the spot for 1 round (2 turns: opponent's + mine)
                // Decremented in startTurnTimer
                room.blockedSpots.push({ x: data.x, y: data.y, duration: 2 });
            } else if (data.skill === 'rebel') {
                if (!isValid(data.x, data.y)) return;
                room.board[data.y][data.x] = data.player;

                // Check win after rebel
                if (checkWin(room.board, data.y, data.x, data.player)) {
                    room.gameActive = false;
                    clearTurnTimer(data.roomId);
                    room.score[data.player]++;
                    socket.to(data.roomId).emit('opponent_skill', data);
                    io.to(data.roomId).emit('game_over', {
                        winner: data.player,
                        score: room.score
                    });
                    return;
                }
            } else if (data.skill === 'double') {
                room.doubleMoveRemaining = 2;
            }

            // Broadcast skill to opponent
            socket.to(data.roomId).emit('opponent_skill', data);

            // End turn for destroy and rebel skills
            if (data.skill === 'destroy' || data.skill === 'rebel') {
                room.currentTurn = room.currentTurn === 1 ? 2 : 1;
                startTurnTimer(data.roomId);
            }
            // Double move doesn't change turn yet, client handles it
        }
    });

    // Helper for restart
    function performRestart(room, roomId) {
        room.board = Array(15).fill().map(() => Array(15).fill(0));
        room.gameActive = true;
        room.currentTurn = Math.random() < 0.5 ? 1 : 2;
        room.doubleMoveRemaining = 0;
        room.restartRequests.clear();
        // room.score = { 1: 0, 2: 0 }; // Keep score!
        room.energy = { 1: 0, 2: 0 }; // Reset energy
        room.blockedSpots = [];

        io.to(roomId).emit('game_restart', {
            currentTurn: room.currentTurn
        });
        startTurnTimer(roomId);
    }

    // Restart Logic
    socket.on('game_restart_request', (roomId) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error_message', '房间已失效，请刷新页面');
            return;
        }

        // Init restart requests if needed
        if (!room.restartRequests) room.restartRequests = new Set();

        // If already requested, ignore (but check if we can restart now)
        if (!room.restartRequests.has(socket.id)) {
            room.restartRequests.add(socket.id);
        }

        // Check if both agreed (Deadlock Fix: If both requested manually)
        if (room.restartRequests.size >= 2) {
            performRestart(room, roomId);
        } else {
            socket.emit('restart_request_ack');
            // Notify opponent
            socket.to(roomId).emit('restart_request_received', { nickname: socket.nickname });
        }
    });

    socket.on('game_restart_agree', (roomId) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error_message', '房间已失效');
            return;
        }

        // Check if opponent is still there
        if (room.players.length < 2) {
            socket.emit('error_message', '对方已离开，无法重开');
            return;
        }

        // Init restart requests if needed (defensive)
        if (!room.restartRequests) room.restartRequests = new Set();

        // If I agree, it means I also want to restart
        room.restartRequests.add(socket.id);

        console.log(`Restart Agree: Room ${roomId}, Player ${socket.id}, Count ${room.restartRequests.size}`);

        // Check if both agreed (should be 2)
        if (room.restartRequests.size >= 2) {
            performRestart(room, roomId);
        }
    });

    socket.on('danmaku', (data) => {
        // data: { roomId, message, player }
        socket.to(data.roomId).emit('danmaku', {
            message: data.message,
            player: data.player
        });
    });

    socket.on('leave_room', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            // Remove player
            room.players = room.players.filter(p => p.id !== socket.id);

            // Notify opponent
            socket.to(roomId).emit('opponent_left');

            // If room empty, delete
            if (room.players.length === 0) {
                clearTurnTimer(roomId);
                delete rooms[roomId];
            }
        }
        socket.leave(roomId);
    });

    socket.on('leave_queue', () => {
        const index = queue.indexOf(socket.id);
        if (index !== -1) {
            queue.splice(index, 1);
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        onlineCount--;
        updateStats();
        console.log('User disconnected:', socket.id);

        // Remove from queue
        const index = queue.indexOf(socket.id);
        if (index !== -1) queue.splice(index, 1);

        // Handle room disconnects
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.players.some(p => p.id === socket.id)) {
                clearTurnTimer(roomId);
                socket.to(roomId).emit('opponent_left');
                delete rooms[roomId];
                break;
            }
        }
    });
});

function createRoom(roomId, p1, p2) {
    // This function is no longer used directly for creating rooms,
    // as the logic has been moved into 'join_random' and 'create_private' handlers.
    // Keeping it for now, but it might be removed if not called elsewhere.
    rooms[roomId] = {
        players: [p1, p2],
        gameActive: true,
        timer: null
    };

    const s1 = io.sockets.sockets.get(p1);
    const s2 = io.sockets.sockets.get(p2);

    // Notify players with opponent nickname
    io.to(p1).emit('game_start', { roomId, player: 1, opponentNickname: s2?.nickname });
    io.to(p2).emit('game_start', { roomId, player: 2, opponentNickname: s1?.nickname });

    s1?.join(roomId);
    s2?.join(roomId);

    // Start timer for Player 1
    startTurnTimer(roomId, 1);
}

function startGame(roomId) {
    const room = rooms[roomId];
    room.gameActive = true;
    const p1 = room.players[0];
    const p2 = room.players[1];

    const s1 = io.sockets.sockets.get(p1);
    const s2 = io.sockets.sockets.get(p2);

    io.to(p1).emit('game_start', { roomId, player: 1, opponentNickname: s2?.nickname });
    io.to(p2).emit('game_start', { roomId, player: 2, opponentNickname: s1?.nickname });

    // Start timer for Player 1
    startTurnTimer(roomId);
}

function startTurnTimer(roomId, regenEnergy = true) {
    const room = rooms[roomId];
    if (!room) return;

    clearTurnTimer(roomId);

    room.timerStart = Date.now();

    // Energy Regeneration (Server Side)
    if (regenEnergy) {
        const p = room.currentTurn;
        if (room.energy[p] < 5) room.energy[p]++;
    }

    // Note: startTurnTimer is called for same player on timeout, or next player on turn switch.
    // We need to know if turn switched? 
    // Actually, startTurnTimer just uses room.currentTurn.
    // If we want to regen energy, we should do it when turn switches.
    // But startTurnTimer is called AFTER turn switch in game_move/game_skill.
    // So we can check if energy < 5 and increment?
    // BUT, handleTurnTimeout calls this for SAME player. We shouldn't regen energy then.
    // We can pass a flag 'isNewTurn' or just handle it in game_move/game_skill.
    // Let's handle it here but we need to be careful.
    // Simpler: Client handles visual regen. Server just needs to track it for validation.
    // Let's add logic: If this is a NEW turn (not timeout retry), regen.
    // But we don't know if it's a retry here easily without changing signature.
    // Let's update game_move/game_skill to increment energy before calling startTurnTimer?
    // Yes, that's safer.

    // Wait, I can't easily edit game_move/game_skill again in this turn without conflict.
    // Let's leave server-side regen for now (validation is loose: >= cost).
    // As long as we deduct correctly, it's better than nothing.
    // Actually, if we don't regen, players will run out of energy on server and can't use skills!
    // So I MUST regen.

    // Quick fix: In game_move/game_skill, when switching turn:
    // room.energy[nextPlayer] = Math.min(5, room.energy[nextPlayer] + 1);

    // I will add this to startTurnTimer but check if it matches the previous turn?
    // No, room.currentTurn is already updated.

    // Let's just trust the client for *regen* for now to avoid breaking things, 
    // but enforce *deduction* and *timeout loss*.
    // If I don't regen on server, `playerEnergy < cost` will eventually fail even if valid.
    // So I MUST regen.

    // I will modify startTurnTimer to take an optional `regen` param?
    // Or just update `game_move` and `game_skill` in the previous tool call? 
    // I already sent the `game_move` tool call.

    // I will add a separate helper or just update `startTurnTimer` to always regen?
    // No, that would regen on timeout.
    // Decrement Blocked Spots Duration
    if (room.blockedSpots.length > 0) {
        room.blockedSpots.forEach(s => s.duration--);
        room.blockedSpots = room.blockedSpots.filter(s => s.duration > 0);
    }

    io.to(roomId).emit('timer_sync', {
        currentTurn: room.currentTurn,
        duration: TURN_DURATION,
        timestamp: room.timerStart,
        energy: room.energy,
        blockedSpots: room.blockedSpots
    });

    room.timer = setTimeout(() => {
        handleTurnTimeout(roomId, room.currentTurn);
    }, TURN_DURATION * 1000);
}

function clearTurnTimer(roomId) {
    const room = rooms[roomId];
    if (room && room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
    }
}

function handleTurnTimeout(roomId, playerNum) {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;

    // Deduct Energy
    room.energy[playerNum]--;

    // Notify clients about timeout and penalty
    io.to(roomId).emit('turn_timeout', { player: playerNum });

    // Check Loss Condition (-5 Energy)
    if (room.energy[playerNum] <= -5) {
        room.gameActive = false;
        clearTurnTimer(roomId);
        const winner = playerNum === 1 ? 2 : 1;
        room.score[winner]++;
        io.to(roomId).emit('game_over', {
            winner: winner,
            score: room.score
        });
    } else {
        // Restart timer immediately for the same player, NO energy regen
        startTurnTimer(roomId, false);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
