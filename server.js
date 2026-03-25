const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const RoomLifecycleManager = require('./RoomLifecycleManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const roomManager = new RoomLifecycleManager(io);

// Serve static files
app.use(express.static(__dirname));

// Stats logic
const STATS_FILE = path.join(__dirname, 'stats.json');
let onlineCount = 0;
let totalVisits = 0;
let visitHistory = [];

function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
            totalVisits = data.totalVisits || 0;
            visitHistory = data.visitHistory || [];
        } else {
            for (let i = 0; i < 24; i++) {
                const d = new Date();
                d.setHours(d.getHours() - i);
                visitHistory.unshift({ time: `${d.getHours()}:00`, count: 0 });
            }
        }
    } catch (err) {
        for (let i = 0; i < 24; i++) {
            const d = new Date();
            d.setHours(d.getHours() - i);
            visitHistory.unshift({ time: `${d.getHours()}:00`, count: 0 });
        }
    }
}

function saveStats() {
    try {
        const data = { totalVisits, visitHistory, lastUpdate: new Date().toISOString() };
        fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) { }
}

loadStats();

function updateStats() {
    io.emit('stats_update', { onlineCount, totalVisits, visitHistory });
    saveStats();
}

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
}, 60000);

io.on('connection', (socket) => {
    onlineCount++;
    totalVisits++;
    visitHistory[visitHistory.length - 1].count = totalVisits;
    updateStats();

    // Send initial config
    socket.emit('stats_update', { onlineCount, totalVisits, visitHistory });

    socket.on('get_stats', () => {
        socket.emit('stats_update', { onlineCount, totalVisits, visitHistory });
    });

    // Delegating Room Management Tasks to RoomLifecycleManager
    socket.on('join_random', (nickname) => {
        roomManager.joinRandom(socket, nickname);
    });

    socket.on('create_private', (nickname) => {
        roomManager.createPrivate(socket, nickname);
    });

    socket.on('join_private', (data) => {
        roomManager.joinPrivate(socket, data.roomId, data.nickname);
    });

    socket.on('leave_queue', () => {
        roomManager.leaveQueue(socket.id);
    });

    socket.on('leave_room', (roomId) => {
        roomManager.handleLeaveRoom(socket, roomId);
    });

    // Game Events routed through RoomLifecycleManager
    socket.on('game_move', (data) => roomManager.handleEvent(socket, data.roomId, 'game_move', data));
    socket.on('game_skill', (data) => roomManager.handleEvent(socket, data.roomId, 'game_skill', data));
    socket.on('game_restart_request', (data) => roomManager.handleEvent(socket, data.roomId, 'game_restart_request', data));
    socket.on('game_restart_agree', (data) => roomManager.handleEvent(socket, data.roomId, 'game_restart_agree', data));
    
    // Lobby Handshake Events
    socket.on('player_select_game', (data) => roomManager.handleLobbyEvent(socket, data.roomId, 'player_select_game', data));
    socket.on('request_start_game', (data) => roomManager.handleLobbyEvent(socket, data.roomId, 'request_start_game', data));
    socket.on('agree_start_game', (data) => roomManager.handleLobbyEvent(socket, data.roomId, 'agree_start_game', data));
    socket.on('leave_game_to_lobby', (data) => roomManager.handleLobbyEvent(socket, data.roomId, 'leave_game_to_lobby', data));
    
    // Global features handled by platform
    socket.on('danmaku', (data) => {
        socket.to(data.roomId).emit('danmaku', { message: data.message, player: data.player });
    });

    socket.on('disconnect', () => {
        onlineCount--;
        updateStats();
        roomManager.handleDisconnect(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
