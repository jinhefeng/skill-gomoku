class GomokuEngine {
    constructor(roomId, context, config = {}) {
        this.roomId = roomId;
        this.context = context; 
        this.skillEnabled = config.skillEnabled !== false; // 接收并应用技能开关
        
        this.TURN_DURATION = 30; // Seconds
        this.boardSize = 15;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.players = []; // [{ id, nickname, player: 1|2 }]
        this.currentTurn = Math.random() < 0.5 ? 1 : 2;
        this.gameActive = false;
        this.timer = null;
        this.timerStart = null;
        this.score = { 1: 0, 2: 0 };
        this.energy = { 1: 0, 2: 0 };
        this.doubleMoveRemaining = 0;
        this.blockedSpots = []; // [{x, y, duration}]
        this.restartRequests = new Set();
    }

    init() {
        // called when engine is mounted
    }

    addPlayer(socketId, nickname) {
        // Assign player 1 or 2
        const playerNum = this.players.length === 0 ? 1 : 2;
        this.players.push({ id: socketId, nickname, player: playerNum });
        
        if (this.players.length === 2) {
            this.gameActive = true;
            this.startGame();
        }
    }

    removePlayer(socketId) {
        this.players = this.players.filter(p => p.id !== socketId);
        this.clearTurnTimer();
        this.context.broadcast('opponent_left');
    }

    startGame() {
        this.players.forEach(p => {
            const opponent = this.players.find(op => op.id !== p.id);
            this.context.emitTo(p.id, 'game_start', {
                roomId: this.roomId,
                gameId: 'gomoku',
                player: p.player,
                opponentNickname: opponent ? opponent.nickname : 'Opponent',
                currentTurn: this.currentTurn,
                skillEnabled: this.skillEnabled,
                score: this.score
            });
        });
        this.startTurnTimer();
    }

    handleEvent(socketId, event, data) {
        const playerObj = this.players.find(p => p.id === socketId);
        if (!playerObj) return;

        if (event === 'game_move') {
            this.handleGameMove(playerObj.player, data);
        } else if (event === 'game_skill') {
            this.handleGameSkill(playerObj.player, data);
        } else if (event === 'game_restart_request') {
            this.handleRestartRequest(socketId);
        } else if (event === 'game_restart_agree') {
            this.handleRestartAgree(socketId);
        }
    }

    handleGameMove(player, data) {
        if (!this.gameActive || player !== this.currentTurn) return;
        const { x, y } = data;

        if (!this.isValid(x, y)) return;
        if (this.blockedSpots.some(s => s.x === x && s.y === y)) {
            const socketId = this.players.find(p => p.player === player).id;
            this.context.emitTo(socketId, 'error_message', '该位置已被破坏，暂时无法落子');
            return;
        }

        if (this.board[y][x] === 0) {
            this.board[y][x] = player;

            if (this.checkWin(y, x, player)) {
                this.gameActive = false;
                this.clearTurnTimer();
                this.score[player]++;
                // Simulate socket.to(roomId).emit -> broadcast with ignore socketId (pseudo handled by client state or we just broadcast to all)
                // For cleanly updating opponent, we can broadcast 'opponent_move'
                this.context.broadcast('opponent_move', data);
                this.context.broadcast('game_over', { winner: player, score: this.score });
            } else {
                if (this.doubleMoveRemaining > 0) {
                    this.doubleMoveRemaining--;
                    this.context.broadcast('opponent_move', data);
                    if (this.doubleMoveRemaining === 0) {
                        this.currentTurn = this.currentTurn === 1 ? 2 : 1;
                        this.startTurnTimer();
                    } else {
                        this.startTurnTimer(false);
                    }
                } else {
                    this.currentTurn = this.currentTurn === 1 ? 2 : 1;
                    this.context.broadcast('opponent_move', data);
                    this.startTurnTimer();
                }
            }
        }
    }

    handleGameSkill(player, data) {
        if (!this.gameActive || player !== this.currentTurn) return;
        
        const playerEnergy = this.energy[player];
        let cost = 0;
        if (data.skill === 'double') cost = 4;
        else if (data.skill === 'rebel') cost = 3;
        else if (data.skill === 'destroy') cost = 2;

        if (playerEnergy < cost) return;

        this.energy[player] -= cost;

        if (data.skill === 'destroy') {
            if (!this.isValid(data.x, data.y)) return;
            this.board[data.y][data.x] = 0;
            this.blockedSpots.push({ x: data.x, y: data.y, duration: 2 });
        } else if (data.skill === 'rebel') {
            if (!this.isValid(data.x, data.y)) return;
            this.board[data.y][data.x] = player;
            if (this.checkWin(data.y, data.x, player)) {
                this.gameActive = false;
                this.clearTurnTimer();
                this.score[player]++;
                data.player = player;
                this.context.broadcast('opponent_skill', data);
                this.context.broadcast('game_over', { winner: player, score: this.score });
                return;
            }
        } else if (data.skill === 'double') {
            this.doubleMoveRemaining = 2;
        }

        data.player = player;
        this.context.broadcast('opponent_skill', data);

        if (data.skill === 'destroy' || data.skill === 'rebel') {
            this.currentTurn = this.currentTurn === 1 ? 2 : 1;
            this.startTurnTimer();
        }
    }

    handleRestartRequest(socketId) {
        if (!this.restartRequests.has(socketId)) {
            this.restartRequests.add(socketId);
        }
        if (this.restartRequests.size >= 2) {
            this.performRestart();
        } else {
            this.context.emitTo(socketId, 'restart_request_ack');
            const player = this.players.find(p => p.id === socketId);
            this.context.broadcast('restart_request_received', { nickname: player.nickname, initiatorNum: player.player }); 
        }
    }

    handleRestartAgree(socketId) {
        if (this.players.length < 2) {
            this.context.emitTo(socketId, 'error_message', '对方已离开，无法重开');
            return;
        }
        this.restartRequests.add(socketId);
        if (this.restartRequests.size >= 2) {
            this.performRestart();
        }
    }

    performRestart() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.gameActive = true;
        this.currentTurn = Math.random() < 0.5 ? 1 : 2;
        this.doubleMoveRemaining = 0;
        this.restartRequests.clear();
        this.energy = { 1: 0, 2: 0 };
        this.blockedSpots = [];

        this.context.broadcast('game_restart', { currentTurn: this.currentTurn });
        this.startTurnTimer();
    }

    // --- Helpers ---

    startTurnTimer(regenEnergy = true) {
        this.clearTurnTimer();
        this.timerStart = Date.now();

        if (regenEnergy && this.skillEnabled) {
            const p = this.currentTurn;
            if (this.energy[p] < 5) this.energy[p]++;
        }

        if (this.blockedSpots.length > 0) {
            this.blockedSpots.forEach(s => s.duration--);
            this.blockedSpots = this.blockedSpots.filter(s => s.duration > 0);
        }

        const syncData = {
            currentTurn: this.currentTurn,
            duration: this.TURN_DURATION,
            timestamp: this.timerStart,
            blockedSpots: this.blockedSpots
        };
        
        // 只有开启技能模式时才发送能量数据，防止前端 UI 误报
        if (this.skillEnabled) {
            syncData.energy = this.energy;
        }

        this.context.broadcast('timer_sync', syncData);

        this.timer = setTimeout(() => {
            this.handleTurnTimeout(this.currentTurn);
        }, this.TURN_DURATION * 1000);
    }

    clearTurnTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    handleTurnTimeout(playerNum) {
        if (!this.gameActive) return;

        this.energy[playerNum]--;
        this.context.broadcast('turn_timeout', { player: playerNum });

        if (this.energy[playerNum] <= -5) {
            this.gameActive = false;
            this.clearTurnTimer();
            const winner = playerNum === 1 ? 2 : 1;
            this.score[winner]++;
            this.context.broadcast('game_over', { winner, score: this.score });
        } else {
            this.startTurnTimer(false);
        }
    }

    isValid(x, y) {
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }

    checkWin(y, x, player) {
        const directions = [ [1, 0], [0, 1], [1, 1], [1, -1] ];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let i = 1; i < 5; i++) {
                const nx = x + dx * i, ny = y + dy * i;
                if (this.isValid(nx, ny) && this.board[ny][nx] === player) count++; else break;
            }
            for (let i = 1; i < 5; i++) {
                const nx = x - dx * i, ny = y - dy * i;
                if (this.isValid(nx, ny) && this.board[ny][nx] === player) count++; else break;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    destroy() {
        this.clearTurnTimer();
        this.gameActive = false;
    }
}

module.exports = GomokuEngine;
