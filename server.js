const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(__dirname));

// Game State
const rooms = {}; // { roomId: { players: [socketId, ...], board: [], turn: 1, ... } }
const queue = []; // [socketId, ...]

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Random Matchmaking
    socket.on('join_random', (nickname) => {
        socket.nickname = nickname || 'Unknown';
        if (queue.length > 0) {
            const opponentId = queue.shift();
            const roomId = `room_${Date.now()}`;
            createRoom(roomId, opponentId, socket.id);
        } else {
            queue.push(socket.id);
            socket.emit('waiting_for_match');
        }
    });

    // Create Private Room
    socket.on('create_private', (nickname) => {
        socket.nickname = nickname || 'Unknown';
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            players: [socket.id],
            gameActive: false
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
    });

    // Join Private Room
    socket.on('join_private', (data) => {
        // data: { roomId, nickname }
        const { roomId, nickname } = data;
        socket.nickname = nickname || 'Unknown';

        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push(socket.id);
            socket.join(roomId);
            startGame(roomId);
        } else {
            socket.emit('error_message', '房间不存在或已满');
        }
    });

    // Game Events
    socket.on('game_move', (data) => {
        // data: { roomId, x, y, player }
        socket.to(data.roomId).emit('opponent_move', data);
    });

    socket.on('game_skill', (data) => {
        // data: { roomId, skill, ... }
        socket.to(data.roomId).emit('opponent_skill', data);
    });

    socket.on('game_restart', (roomId) => {
        socket.to(roomId).emit('opponent_restart');
    });

    socket.on('danmaku', (data) => {
        // data: { roomId, message, player }
        socket.to(data.roomId).emit('danmaku', {
            message: data.message,
            player: data.player
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Remove from queue
        const index = queue.indexOf(socket.id);
        if (index !== -1) queue.splice(index, 1);

        // Handle room disconnects
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.players.includes(socket.id)) {
                socket.to(roomId).emit('opponent_left');
                delete rooms[roomId];
                break;
            }
        }
    });
});

function createRoom(roomId, p1, p2) {
    rooms[roomId] = {
        players: [p1, p2],
        gameActive: true
    };

    const s1 = io.sockets.sockets.get(p1);
    const s2 = io.sockets.sockets.get(p2);

    // Notify players with opponent nickname
    io.to(p1).emit('game_start', { roomId, player: 1, opponentNickname: s2?.nickname });
    io.to(p2).emit('game_start', { roomId, player: 2, opponentNickname: s1?.nickname });

    s1?.join(roomId);
    s2?.join(roomId);
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
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
