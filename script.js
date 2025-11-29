class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    playTone(freq, type, duration, vol = 0.1) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    resume() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    playPlace() {
        this.playTone(800, 'sine', 0.1, 0.2);
        setTimeout(() => this.playTone(1200, 'sine', 0.05, 0.1), 50);
    }

    playBeep() {
        this.playTone(440, 'square', 0.1, 0.1);
    }

    playWin() {
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.playTone(f, 'sine', 0.3, 0.2), i * 150));
    }
}

class GameState {
    constructor() {
        this.boardSize = 15;
        this.board = [];
        this.currentPlayer = 1;
        this.myPlayerNum = 1; // 1 or 2 (For online play)
        this.isOnline = false;
        this.roomId = null;
        this.socket = null;
        this.myNickname = 'Me';
        this.opponentNickname = 'Opponent';
        this.isMatching = false; // Prevent double click

        this.players = {
            1: { energy: 0, maxEnergy: 5, color: 'p1', score: 0 },
            2: { energy: 0, maxEnergy: 5, color: 'p2', score: 0 }
        };
        this.gameActive = false;
        this.activeSkill = null;
        this.doubleMoveRemaining = 0;

        // Highlight Tracking
        this.lastMoves = []; // [{x, y}, ...]
        this.destroyedMarkers = []; // [{x, y}, ...]
        this.isFirstMoveOfTurn = true;

        this.soundManager = new SoundManager();

        this.initBoard();
        this.initUI();

        // Immediate Socket Connection for Stats
        this.initSocket();

        // Load nickname
        const savedName = localStorage.getItem('gomoku_nickname');
        if (savedName) {
            document.getElementById('nicknameInput').value = savedName;
        }

        // Resume Audio Context on first interaction
        document.addEventListener('click', () => {
            this.soundManager.resume();
        }, { once: true });
    }

    initBoard() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        const boardEl = document.getElementById('gameBoard');
        boardEl.innerHTML = '';

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                cell.onclick = () => this.handleCellClick(x, y);
                boardEl.appendChild(cell);
            }
        }
    }

    initUI() {
        document.getElementById('winOverlay').classList.add('hidden');
        document.getElementById('menuOverlay').style.display = 'flex';
        document.getElementById('gameArena').classList.add('blur-bg');

        // Enter key for chat
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendDanmaku();
        });
    }

    validateNickname() {
        const input = document.getElementById('nicknameInput');
        const name = input.value.trim();
        if (!name) {
            input.classList.add('input-error');
            setTimeout(() => input.classList.remove('input-error'), 500);
            return null;
        }
        localStorage.setItem('gomoku_nickname', name);
        return name;
    }

    getNickname() {
        return document.getElementById('nicknameInput').value.trim() || '玩家';
    }

    // --- Menu Actions ---
    startLocal() {
        // Leave any existing room or queue
        if (this.roomId) {
            this.socket.emit('leave_room', this.roomId);
            this.roomId = null;
        }
        if (this.isMatching) {
            this.socket.emit('leave_queue');
        }
        this.resetUIState();

        const name = this.validateNickname();
        if (!name) return;

        this.isOnline = false;
        this.myPlayerNum = 1;
        this.myNickname = name;
        this.opponentNickname = '本地玩家 2';

        this.players[1].name = this.myNickname;
        this.players[2].name = this.opponentNickname;

        this.startGame();
    }



    startRandom() {
        if (this.isMatching) return;

        // Leave any existing room
        if (this.roomId) {
            this.socket.emit('leave_room', this.roomId);
            this.roomId = null;
        }
        this.resetUIState();

        const name = this.validateNickname();
        if (!name) return;

        this.isMatching = true;

        const btn = document.querySelector('button[onclick="game.startRandom()"]');
        if (btn) btn.disabled = true;

        this.myNickname = name;
        // Socket already inited, just emit
        this.socket.emit('join_random', this.myNickname);
        document.getElementById('waitingMsg').classList.remove('hidden');
    }

    createPrivate() {
        // Leave any existing room
        if (this.roomId) {
            this.socket.emit('leave_room', this.roomId);
            this.roomId = null;
        }
        if (this.isMatching) {
            this.socket.emit('leave_queue');
        }
        this.resetUIState();

        const name = this.validateNickname();
        if (!name) return;

        this.myNickname = name;
        this.socket.emit('create_private', this.myNickname);
    }

    joinPrivate() {
        // Leave any existing room
        if (this.roomId) {
            this.socket.emit('leave_room', this.roomId);
            this.roomId = null;
        }
        if (this.isMatching) {
            this.socket.emit('leave_queue');
        }
        this.resetUIState();

        const roomId = document.getElementById('roomIdInput').value.trim();
        if (!roomId) return alert('请输入房间号');

        const name = this.validateNickname();
        if (!name) return;

        this.myNickname = name;
        this.socket.emit('join_private', { roomId, nickname: this.myNickname });
    }

    initSocket() {
        if (this.socket) return;

        if (typeof io === 'undefined') {
            // Only alert if we are actually trying to play online, or just log for stats?
            // For stats, we want to try silently.
            console.warn('Socket.io not found. Stats will not load.');
            return;
        }

        this.socket = io();
        this.isOnline = true;

        this.socket.on('connect', () => {
            console.log('Connected to server, requesting stats...');
            this.socket.emit('get_stats');
        });

        // Stats
        this.socket.on('stats_update', (data) => {
            console.log('Stats received:', data);
            const onlineEl = document.getElementById('onlineCount');
            const visitsEl = document.getElementById('totalVisits');
            if (onlineEl) onlineEl.innerText = data.onlineCount;
            if (visitsEl) visitsEl.innerText = data.totalVisits;
            this.visitHistory = data.visitHistory;
        });

        this.socket.on('waiting_for_match', () => {
            document.getElementById('waitingMsg').classList.remove('hidden');
            document.getElementById('waitingText').innerText = '正在寻找对手...';
            document.getElementById('roomIdBadge').classList.add('hidden');
        });

        this.socket.on('room_created', (id) => {
            this.roomId = id;
            document.getElementById('waitingMsg').classList.remove('hidden');
            document.getElementById('waitingText').innerText = '房间已创建! 等待对手加入...';

            const badge = document.getElementById('roomIdBadge');
            badge.classList.remove('hidden');
            document.getElementById('roomIdDisplay').innerText = id;
        });

        this.socket.on('game_start', (data) => {
            this.roomId = data.roomId;
            this.myPlayerNum = data.player;
            this.opponentNickname = data.opponentNickname || '对手';
            this.isMatching = false;
            const btn = document.querySelector('button[onclick="game.startRandom()"]');
            if (btn) btn.disabled = false;

            // Sync Score
            if (data.score) {
                this.players[1].score = data.score[1];
                this.players[2].score = data.score[2];
            }

            // Sync Turn
            if (data.currentTurn) {
                this.currentPlayer = data.currentTurn;
            }

            // We are now in an online game
            this.isOnline = true;
            this.startGame(data.currentTurn);
        });

        this.socket.on('opponent_move', (data) => {
            this.receiveMove(data);
        });

        this.socket.on('opponent_skill', (data) => {
            this.receiveSkill(data);
        });

        this.socket.on('game_restart', (data) => {
            const btn = document.getElementById('restartBtn');
            if (btn) {
                btn.innerText = '重新开始';
                btn.disabled = false;
                btn.classList.remove('waiting', 'pulse');
            }
            // Reset scores if provided, though startGame usually resets them locally. 
            // But for online, we might want to keep them? 
            // The user said "restart", implying a full reset usually.
            // But wait, usually "restart" in online games might mean "rematch" (keep score) or "new game" (reset score).
            // The current logic resets score. I will stick to that.
            this.startGame(data.currentTurn);
        });

        this.socket.on('restart_request_ack', () => {
            // Just confirmation that server received it
        });

        this.socket.on('restart_request_received', (data) => {
            const btn = document.getElementById('restartBtn');
            if (btn) {
                btn.innerText = `对方请求重开 (点击同意)`;
                btn.classList.add('pulse');
                btn.onclick = () => {
                    this.socket.emit('game_restart_agree', this.roomId);
                    btn.innerText = '等待服务器...';
                    btn.disabled = true;
                };
            }
        });

        this.socket.on('opponent_left', () => {
            alert('对手已离开');
            location.reload();
        });

        this.socket.on('danmaku', (data) => {
            this.showDanmaku(data.message, data.player);
        });

        this.socket.on('error_message', (msg) => {
            alert(msg);
            this.isMatching = false;
            const btn = document.querySelector('button[onclick="game.startRandom()"]');
            if (btn) btn.disabled = false;

            // Reset Restart Button
            const restartBtn = document.getElementById('restartBtn');
            if (restartBtn) {
                restartBtn.innerText = '再来一局';
                restartBtn.disabled = false;
                restartBtn.classList.remove('waiting', 'pulse');
                restartBtn.onclick = () => this.restart(); // Restore original handler
            }
        });

        // Timer Events
        // Timer Events
        this.socket.on('timer_sync', (data) => {
            console.log('Timer Sync:', data);
            // Sync current turn from server
            if (data.currentTurn && data.currentTurn !== this.currentPlayer) {
                this.currentPlayer = data.currentTurn;

                // Energy Regeneration (Online)
                const player = this.players[this.currentPlayer];
                if (player.energy < player.maxEnergy) {
                    player.energy++;
                }

                // Reset Highlight Flag for new turn
                this.isFirstMoveOfTurn = true;

                this.updateUI();
            }
            this.startTimer(data.player, data.duration, data.timestamp);
        });

        this.socket.on('game_over', (data) => {
            // Update scores from server
            if (data.score) {
                this.players[1].score = data.score[1];
                this.players[2].score = data.score[2];
            }
            this.endGame(data.winner, '对方获胜');
        });

        this.socket.on('turn_timeout', (data) => {
            // Penalty: -1 Energy
            const player = this.players[data.player];
            player.energy--;
            this.updateUI();

            // Check Loss Condition
            if (player.energy <= -5) {
                // If it's me, I lose. If opponent, they lose.
                const winner = data.player === 1 ? 2 : 1;
                this.endGame(winner, '超时判负');
            }
        });
    }

    // --- Stats & Room ID ---
    showOnlineUsers() {
        // Disabled
    }

    showVisitHistory() {
        const modal = document.getElementById('statsModal');
        modal.classList.remove('hidden');
        document.getElementById('modalTitle').innerText = '访问趋势 (24小时)';

        if (!this.visitHistory) return;

        // Draw Chart
        setTimeout(() => this.drawVisitChart(), 100);
    }

    drawVisitChart() {
        const canvas = document.getElementById('visitChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.parentElement.clientWidth;
        const height = canvas.parentElement.clientHeight;

        canvas.width = width;
        canvas.height = height;

        ctx.clearRect(0, 0, width, height);

        const data = this.visitHistory;
        if (data.length < 2) return;

        const padding = 40;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        // Find max value for scaling
        const maxVal = Math.max(...data.map(d => d.count), 10); // Min scale 10

        // Draw Axes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;

        // Y Axis
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.stroke();

        // X Axis
        ctx.beginPath();
        ctx.moveTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw Y-axis labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';

        const ySteps = 5; // Number of Y-axis labels
        for (let i = 0; i <= ySteps; i++) {
            const value = Math.round((maxVal / ySteps) * i);
            const y = height - padding - (i / ySteps) * chartHeight;

            // Draw tick mark
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath();
            ctx.moveTo(padding - 5, y);
            ctx.lineTo(padding, y);
            ctx.stroke();

            // Draw label
            ctx.fillText(value, padding - 8, y + 3);

            // Draw grid line (optional, subtle)
            if (i > 0 && i < ySteps) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(width - padding, y);
                ctx.stroke();
            }
        }

        // Draw Line
        ctx.strokeStyle = '#00f2ff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const stepX = chartWidth / (data.length - 1);

        data.forEach((point, i) => {
            const x = padding + i * stepX;
            const y = height - padding - (point.count / maxVal) * chartHeight;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);

            // Draw Point
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();

            // Draw Label (every 4 hours)
            if (i % 4 === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(point.time, x, height - padding + 15);
            }
        });
        ctx.stroke();
    }

    copyRoomId() {
        if (!this.roomId) return;
        navigator.clipboard.writeText(this.roomId).then(() => {
            const hint = document.querySelector('.copy-hint');
            const original = hint.innerText;
            hint.innerText = '✅ 已复制!';
            setTimeout(() => hint.innerText = original, 2000);
        });
    }

    // --- Timer Logic ---
    startTimer(playerNum, duration, timestamp) {
        if (this.timerInterval) clearInterval(this.timerInterval);

        const endTime = timestamp + duration * 1000;

        const update = () => {
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));

            // Update UI
            document.getElementById('p1Timer').classList.add('hidden');
            document.getElementById('p2Timer').classList.add('hidden');

            const timerEl = document.getElementById(`p${playerNum}Timer`);
            if (timerEl) {
                timerEl.classList.remove('hidden');
                timerEl.innerText = `${remaining}s`;

                if (remaining <= 3) {
                    timerEl.classList.add('warning');
                    // Play beep if integer second changed
                    if (this.lastBeep !== remaining && remaining > 0) {
                        this.soundManager.playBeep();
                        this.lastBeep = remaining;
                    }
                } else {
                    timerEl.classList.remove('warning');
                }
            }

            if (remaining === 0) {
                clearInterval(this.timerInterval);
                if (!this.isOnline) {
                    this.handleLocalTimeout(playerNum);
                }
            }
        };

        this.lastBeep = -1; // Reset beep tracker
        update();
        this.timerInterval = setInterval(update, 100);
    }

    startLocalTimer(playerNum) {
        // Local timer simulates server timer
        this.startTimer(playerNum, 30, Date.now());
    }

    handleLocalTimeout(playerNum) {
        // Local penalty logic
        const player = this.players[playerNum];
        player.energy--;
        this.updateUI();

        if (player.energy <= -5) {
            const winner = playerNum === 1 ? 2 : 1;
            this.endGame(winner, '超时判负');
        } else {
            // Restart timer for same player
            this.startLocalTimer(playerNum);
        }
    }

    startGame(serverTurn = null) {
        this.gameActive = true;
        document.body.classList.add('game-active'); // Hide footer

        if (serverTurn) {
            this.currentPlayer = serverTurn;
        } else if (!this.roomId) {
            this.currentPlayer = Math.random() < 0.5 ? 1 : 2;
        }

        this.players[1].energy = 0;
        this.players[2].energy = 0;
        this.activeSkill = null;
        this.doubleMoveRemaining = 0;

        // Reset highlights
        this.lastMoves = [];
        this.destroyedMarkers = [];
        this.isFirstMoveOfTurn = true;

        document.getElementById('menuOverlay').style.display = 'none';
        document.getElementById('winOverlay').classList.add('hidden'); // Hide win overlay
        document.getElementById('gameArena').classList.remove('blur-bg');

        // Show Chat Bar if online
        if (this.roomId) {
            document.getElementById('chatBar').classList.remove('hidden');
        } else {
            document.getElementById('chatBar').classList.add('hidden');
            // Start Local Timer if not in an online room
            // For local game, random start?
            // If local, we might want random start too.
            // this.currentPlayer is already set above
            this.startLocalTimer(this.currentPlayer);
        }

        this.updateUI();
        this.initBoard(); // Re-render board to clear old state
    }

    // --- Social ---
    sendDanmaku() {
        const input = document.getElementById('chatInput');
        const msg = input.value.trim();
        if (!msg) return;

        this.showDanmaku(msg, this.myPlayerNum);

        if (this.roomId) {
            this.socket.emit('danmaku', {
                roomId: this.roomId,
                message: msg,
                player: this.myPlayerNum
            });
        }
        input.value = '';
    }

    showDanmaku(text, playerNum) {
        const container = document.getElementById('danmakuContainer');
        const item = document.createElement('div');
        item.className = 'danmaku-item';
        item.innerText = text;
        item.style.top = `${Math.random() * 80}%`;

        // Random speed (5s to 12s)
        const duration = 5 + Math.random() * 7;
        item.style.animationDuration = `${duration}s`;

        // Color based on player number
        if (playerNum === 1) {
            item.style.color = 'var(--p1-color)';
            item.style.textShadow = '0 0 5px var(--p1-glow)';
        } else {
            item.style.color = 'var(--p2-color)';
            item.style.textShadow = '0 0 5px var(--p2-glow)';
        }

        container.appendChild(item);

        setTimeout(() => {
            item.remove();
        }, duration * 1000);
    }

    // --- Game Logic ---

    handleCellClick(x, y) {
        if (!this.gameActive) return;

        // Online check: Is it my turn?
        if (this.roomId && this.currentPlayer !== this.myPlayerNum) return;

        // Skill Handling
        if (this.activeSkill === 'destroy') {
            this.executeDestroy(x, y);
            return;
        }
        if (this.activeSkill === 'rebel') {
            this.executeRebel(x, y);
            return;
        }

        // Normal Move
        if (this.board[y][x] !== 0) return;

        this.placeStone(x, y, this.currentPlayer);

        // Emit Move
        if (this.roomId) {
            this.socket.emit('game_move', { roomId: this.roomId, x, y, player: this.currentPlayer });
        }

        if (this.checkWin(x, y, this.currentPlayer)) {
            this.endGame(this.currentPlayer);
            return;
        }

        // Only handle turn locally if not in online mode
        if (!this.roomId) {
            if (this.doubleMoveRemaining > 0) {
                this.doubleMoveRemaining--;
                if (this.doubleMoveRemaining === 0) {
                    this.endTurn();
                }
            } else {
                this.endTurn();
            }
        }
        // In online mode, server will handle turn switching
    }

    receiveMove(data) {
        // Opponent placed a stone
        this.placeStone(data.x, data.y, data.player);

        if (this.checkWin(data.x, data.y, data.player)) {
            this.endGame(data.player);
            return;
        }

        // Server handles turn switching in online mode via timer_sync
        // No need to call endTurn here for online games
    }

    receiveSkill(data) {
        // Opponent used a skill
        const player = this.players[data.player];
        player.energy -= data.cost;

        if (data.skill === 'double') {
            this.doubleMoveRemaining = 2;
        } else if (data.skill === 'destroy') {
            this.board[data.y][data.x] = 0;
            // Add destroyed marker
            this.destroyedMarkers.push({ x: data.x, y: data.y });
            this.renderCell(data.x, data.y);
            this.endTurn();
        } else if (data.skill === 'rebel') {
            this.board[data.y][data.x] = data.player;
            // Treat rebel as a new move for highlight?
            this.lastMoves = [{ x: data.x, y: data.y }];
            // Clear previous highlights visually
            document.querySelectorAll('.cell').forEach(c => c.classList.remove('last-move'));
            this.renderCell(data.x, data.y);
            // Check win for opponent after rebel?
            if (this.checkWin(data.x, data.y, data.player)) {
                this.endGame(data.player);
                return;
            }
            this.endTurn();
        }
        this.updateUI();
    }

    placeStone(x, y, player) {
        this.board[y][x] = player;
        this.soundManager.playPlace(); // 落子音效

        // Highlight Logic
        // If this is the start of a new turn sequence (not a double move continuation), clear old highlights
        // Actually, simpler: Just always add to lastMoves.
        // But we need to clear opponent's moves when WE start moving.
        // And clear OUR moves when OPPONENT starts moving.
        // The `endTurn` function switches `currentPlayer`.
        // So, if `currentPlayer` matches the stone being placed, it's the current turn.

        // We want to show the moves of the *last* player who moved.
        // So we accumulate moves in `lastMoves`.
        // When the turn switches, we *keep* them so the other player can see them.
        // When the *next* player places a stone, we clear the *previous* player's highlights.

        // Implementation:
        // Check if the player placing the stone is different from the one who made the moves in `lastMoves`.
        // If so, clear `lastMoves`.

        // But we don't store who made the last moves.
        // Let's just clear `lastMoves` if `doubleMoveRemaining` is 0 (meaning a fresh turn started) AND it's the first move?
        // No, `doubleMoveRemaining` is set *after* skill use.

        // Robust way:
        // When `endTurn` is called, we flag that the *next* move should clear highlights?
        // Or simpler:
        // `this.lastMoves` always contains the moves of the *current active turn sequence*.
        // When `endTurn` happens, we don't clear.
        // When `placeStone` happens:
        // If `currentPlayer` != `lastMovePlayer`, clear.

        if (this.lastMoves.length > 0) {
            const lastMove = this.lastMoves[0];
            const lastPlayer = this.board[lastMove.y][lastMove.x]; // This might be 0 if destroyed, but we handle placeStone here.
            // Wait, we need to know who made the last move.
            // Let's store `lastMovePlayer` in state.
        }

        // Simpler approach:
        // Just clear `lastMoves` whenever `currentPlayer` changes in `endTurn`? 
        // No, then we won't see what opponent did.

        // Correct approach:
        // We want to highlight the moves made by the *previous* player during their turn.
        // So, `lastMoves` should accumulate moves.
        // When a player *starts* their turn (makes their first move), we clear the *other* player's highlights.

        // How to detect "first move of turn"?
        // We can use a flag `isFirstMoveOfTurn`.
        // Set to true in `endTurn`.
        // In `placeStone`, if `isFirstMoveOfTurn`, clear `lastMoves`, set false.

        if (this.isFirstMoveOfTurn) {
            // Remove highlight from OLD lastMoves only
            this.lastMoves.forEach(m => {
                const cell = document.querySelector(`.cell[data-x="${m.x}"][data-y="${m.y}"]`);
                if (cell) cell.classList.remove('last-move');
            });
            this.lastMoves = [];
            this.isFirstMoveOfTurn = false;
        }

        this.lastMoves.push({ x, y });

        // Also remove any destroyed marker at this location if we place a stone there
        this.destroyedMarkers = this.destroyedMarkers.filter(m => m.x !== x || m.y !== y);

        this.renderCell(x, y);

        // No need to re-scan all cells. renderCell handles the new stone's highlight.
        // And the block above handled removing old highlights.
    }

    renderCell(x, y) {
        const index = y * this.boardSize + x;
        const cell = document.getElementById('gameBoard').children[index];

        // Reset classes but keep 'cell'
        cell.className = 'cell';

        // Check Highlight
        const isLastMove = this.lastMoves.some(m => m.x === x && m.y === y);
        if (isLastMove) cell.classList.add('last-move');

        // Check Destroyed
        const isDestroyed = this.destroyedMarkers.some(m => m.x === x && m.y === y);
        if (isDestroyed) cell.classList.add('destroyed-marker');

        const val = this.board[y][x];
        let stone = cell.querySelector('.stone');

        if (val !== 0) {
            if (!stone) {
                stone = document.createElement('div');
                cell.appendChild(stone);
            }
            // Update class only if needed to avoid re-triggering animation if it was already correct
            // Actually, changing class might not re-trigger animation unless the element is removed/added.
            // But to be safe, we only set it if different.
            const newClass = `stone p${val}`;
            if (stone.className !== newClass) {
                stone.className = newClass;
            }
        } else {
            if (stone) {
                stone.remove();
            }
        }
    }


    activateSkill(skillName) {
        if (!this.gameActive) return;
        if (this.roomId && this.currentPlayer !== this.myPlayerNum) return;

        if (this.activeSkill === skillName) {
            this.cancelSkill();
            return;
        }

        const player = this.players[this.currentPlayer];
        let cost = 0;

        switch (skillName) {
            case 'double': cost = 4; break;
            case 'destroy': cost = 2; break;
            case 'rebel': cost = 3; break;
        }

        if (player.energy >= cost) {
            this.activeSkill = skillName;

            if (skillName === 'double') {
                player.energy -= cost;
                this.doubleMoveRemaining = 2; // Logic: 2 moves remaining
                // Wait, doubleMoveRemaining logic in handleCellClick decrements it.
                // If I set it to 2, first move -> 1, second move -> 0 -> endTurn. Correct.
                this.activeSkill = null;

                if (this.roomId) {
                    this.socket.emit('game_skill', { roomId: this.roomId, skill: 'double', cost, player: this.currentPlayer });
                }
                this.updateUI();
            } else {
                // Target skills (Destroy, Rebel) - don't blur, just highlight button
                // The updateUI will handle highlighting the active skill button
            }
            this.updateUI();
        }
    }

    executeDestroy(x, y) {
        if (this.board[y][x] === 0) return; // Can only destroy stones

        this.board[y][x] = 0;
        this.destroyedMarkers.push({ x, y });
        this.renderCell(x, y);
        this.soundManager.playPlace(); // Sound

        // Deduct Energy
        this.players[this.currentPlayer].energy -= 2;
        this.activeSkill = null;
        this.updateUI();

        if (this.roomId) {
            this.socket.emit('game_skill', { roomId: this.roomId, skill: 'destroy', x, y, cost: 2, player: this.currentPlayer });
        }

        this.endTurn();
    }

    executeRebel(x, y) {
        if (this.board[y][x] === 0) return; // Can only rebel stones
        if (this.board[y][x] === this.currentPlayer) return; // Can only rebel opponent stones

        this.board[y][x] = this.currentPlayer;
        this.lastMoves = [{ x, y }];
        document.querySelectorAll('.cell').forEach(c => c.classList.remove('last-move'));
        this.renderCell(x, y);
        this.soundManager.playPlace();

        // Deduct Energy
        this.players[this.currentPlayer].energy -= 3;
        this.activeSkill = null;
        this.updateUI();

        if (this.roomId) {
            this.socket.emit('game_skill', { roomId: this.roomId, skill: 'rebel', x, y, cost: 3, player: this.currentPlayer });
        }

        if (this.checkWin(x, y, this.currentPlayer)) {
            this.endGame(this.currentPlayer);
            return;
        }

        this.endTurn();
    }

    cancelSkill() {
        this.activeSkill = null;
        this.updateUI();
    }

    endTurn() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.isFirstMoveOfTurn = true; // Next move will be first of new turn

        const player = this.players[this.currentPlayer];
        if (player.energy < player.maxEnergy) {
            player.energy++;
        }

        this.updateUI();

        if (!this.roomId) {
            this.startLocalTimer(this.currentPlayer);
        }
    }

    updateUI() {
        const indicator = document.getElementById('turnIndicator');
        if (indicator) {
            indicator.innerText = `玩家 ${this.currentPlayer} 回合`;
            indicator.style.color = this.currentPlayer === 1 ? 'var(--p1-color)' : 'var(--p2-color)';
            indicator.style.borderColor = this.currentPlayer === 1 ? 'var(--p1-color)' : 'var(--p2-color)';
        }

        document.getElementById('p1Panel').classList.toggle('active', this.currentPlayer === 1);
        document.getElementById('p2Panel').classList.toggle('active', this.currentPlayer === 2);

        // Update Names
        if (this.roomId) {
            // Online: Names are set in startGame/socket events
            // But we need to ensure they are stored in this.players for endGame to use
            if (this.myPlayerNum === 1) {
                this.players[1].name = this.myNickname;
                this.players[2].name = this.opponentNickname;
            } else {
                this.players[1].name = this.opponentNickname;
                this.players[2].name = this.myNickname;
            }
        }

        document.getElementById('p1Name').innerText = this.players[1].name + (this.myPlayerNum === 1 ? ' (你)' : '');
        document.getElementById('p2Name').innerText = this.players[2].name + (this.myPlayerNum === 2 ? ' (你)' : '');

        // Update Scores
        document.getElementById('p1Score').innerText = this.players[1].score;
        document.getElementById('p2Score').innerText = this.players[2].score;

        this.updateEnergyBar(1);
        this.updateEnergyBar(2);

        this.updateSkillButtons(1);
        this.updateSkillButtons(2);
    }

    updateEnergyBar(playerNum) {
        const player = this.players[playerNum];
        const fill = document.getElementById(`p${playerNum}EnergyFill`);
        const text = document.getElementById(`p${playerNum}EnergyText`);

        // Handle negative energy for display
        const displayEnergy = Math.max(0, player.energy);
        const pct = (displayEnergy / player.maxEnergy) * 100;

        fill.style.width = `${pct}%`;
        text.innerText = `${player.energy}/${player.maxEnergy} 能量`;

        // Visual warning for negative energy
        if (player.energy < 0) {
            text.style.color = '#ff4444';
        } else {
            text.style.color = 'rgba(255, 255, 255, 0.8)';
        }
    }

    updateSkillButtons(playerNum) {
        const player = this.players[playerNum];
        // Only enable buttons if it's THIS player's turn AND (Local Play OR It's MY client's turn)
        const isTurn = this.currentPlayer === playerNum;
        const isMyClient = !this.roomId || this.myPlayerNum === playerNum;

        const panel = document.getElementById(`p${playerNum}Panel`);
        const buttons = panel.querySelectorAll('.skill-btn');

        buttons.forEach(btn => {
            const cost = parseInt(btn.dataset.cost);
            const skill = btn.dataset.skill;

            if (isTurn && isMyClient && player.energy >= cost) {
                btn.disabled = false;
            } else {
                btn.disabled = true;
            }

            if (isTurn && this.activeSkill === skill) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    checkWin(x, y, player) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let i = 1; i < 5; i++) {
                const nx = x + dx * i;
                const ny = y + dy * i;
                if (this.isValid(nx, ny) && this.board[ny][nx] === player) count++;
                else break;
            }
            for (let i = 1; i < 5; i++) {
                const nx = x - dx * i;
                const ny = y - dy * i;
                if (this.isValid(nx, ny) && this.board[ny][nx] === player) count++;
                else break;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    isValid(x, y) {
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }

    endGame(winner, reason = '') {
        this.gameActive = false;
        document.body.classList.remove('game-active'); // Show footer
        if (this.timerInterval) clearInterval(this.timerInterval);

        // 更新积分 (Local only, Online handled by game_over event)
        if (!this.roomId) {
            this.players[winner].score++;
        }
        this.updateUI(); // 更新UI显示新的积分

        const overlay = document.getElementById('winOverlay');
        const text = document.getElementById('winnerText');

        const winnerName = this.players[winner].name || `玩家 ${winner}`;
        text.innerText = `${winnerName} 获胜!${reason ? '\n(' + reason + ')' : ''}`;

        text.style.background = winner === 1
            ? 'linear-gradient(45deg, var(--p1-color), #fff)'
            : 'linear-gradient(45deg, var(--p2-color), #fff)';
        text.style.webkitBackgroundClip = 'text';

        overlay.classList.remove('hidden');
    }

    resetUIState() {
        this.isMatching = false;
        document.getElementById('waitingMsg').classList.add('hidden');
        document.getElementById('roomIdBadge').classList.add('hidden');
        const btn = document.querySelector('button[onclick="game.startRandom()"]');
        if (btn) btn.disabled = false;
    }

    restart(isOnline = false, serverTurn = null) {
        // Check if we are in an online game AND this is a user request (not server event)
        if (this.isOnline && this.roomId && !isOnline) {
            // Request restart
            this.socket.emit('game_restart_request', this.roomId);
            const btn = document.getElementById('restartBtn');
            if (btn) {
                btn.innerText = '等待对方同意...';
                btn.disabled = true;
                btn.classList.add('waiting');
            }
            return;
        }

        // Local restart logic (or server triggered restart)
        // Do NOT reset scores, allow accumulation
        this.startGame(serverTurn);
    }
}

const game = new GameState();
