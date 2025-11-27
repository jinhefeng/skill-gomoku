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

        this.players = {
            1: { energy: 0, maxEnergy: 5, color: 'p1' },
            2: { energy: 0, maxEnergy: 5, color: 'p2' }
        };
        this.gameActive = false;
        this.activeSkill = null;
        this.doubleMoveRemaining = 0;

        this.initBoard();
        this.initUI();
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

    getNickname() {
        return document.getElementById('nicknameInput').value.trim() || '玩家';
    }

    // --- Menu Actions ---
    startLocal() {
        this.isOnline = false;
        this.myPlayerNum = 1; // Local play allows controlling both, but logic assumes current turn
        this.myNickname = '玩家 1';
        this.opponentNickname = '玩家 2';
        this.startGame();
    }

    startRandom() {
        this.myNickname = this.getNickname();
        this.initSocket();
        this.socket.emit('join_random', this.myNickname);
        document.getElementById('waitingMsg').classList.remove('hidden');
    }

    createPrivate() {
        this.myNickname = this.getNickname();
        this.initSocket();
        this.socket.emit('create_private', this.myNickname);
    }

    joinPrivate() {
        const roomId = document.getElementById('roomIdInput').value.trim();
        if (!roomId) return alert('请输入房间号');
        this.myNickname = this.getNickname();
        this.initSocket();
        this.socket.emit('join_private', { roomId, nickname: this.myNickname });
    }

    initSocket() {
        if (this.socket) return;

        if (typeof io === 'undefined') {
            alert('错误：无法连接到服务器。\n\n请确保：\n1. 你已经运行了 "node server.js"\n2. 你是通过 "http://localhost:3000" 访问的，而不是直接打开文件。');
            return;
        }

        this.socket = io();
        this.isOnline = true;

        this.socket.on('waiting_for_match', () => {
            document.getElementById('waitingMsg').innerText = '正在寻找对手...';
            document.getElementById('waitingMsg').classList.remove('hidden');
        });

        this.socket.on('room_created', (id) => {
            this.roomId = id;
            document.getElementById('waitingMsg').innerText = `房间已创建! 房间号: ${id} (等待对手加入...)`;
            document.getElementById('waitingMsg').classList.remove('hidden');
        });

        this.socket.on('game_start', (data) => {
            this.roomId = data.roomId;
            this.myPlayerNum = data.player;
            this.opponentNickname = data.opponentNickname || '对手';
            this.startGame();
            // alert(`游戏开始! 你是 玩家 ${this.myPlayerNum}`);
        });

        this.socket.on('opponent_move', (data) => {
            this.receiveMove(data);
        });

        this.socket.on('opponent_skill', (data) => {
            this.receiveSkill(data);
        });

        this.socket.on('opponent_restart', () => {
            this.restart(true);
        });

        this.socket.on('opponent_left', () => {
            alert('对手已离开');
            location.reload();
        });

        this.socket.on('danmaku', (msg) => {
            this.showDanmaku(msg, false);
        });

        this.socket.on('error_message', (msg) => {
            alert(msg);
        });
    }

    startGame() {
        this.gameActive = true;
        this.currentPlayer = 1;
        this.players[1].energy = 0;
        this.players[2].energy = 0;
        this.activeSkill = null;
        this.doubleMoveRemaining = 0;

        document.getElementById('menuOverlay').style.display = 'none';
        document.getElementById('gameArena').classList.remove('blur-bg');

        // Show Chat Bar if online
        if (this.isOnline) {
            document.getElementById('chatBar').classList.remove('hidden');
        } else {
            document.getElementById('chatBar').classList.add('hidden');
        }

        this.updateUI();
    }

    // --- Social ---
    sendDanmaku() {
        const input = document.getElementById('chatInput');
        const msg = input.value.trim();
        if (!msg) return;

        this.showDanmaku(msg, true);
        if (this.isOnline) {
            this.socket.emit('danmaku', { roomId: this.roomId, message: msg });
        }
        input.value = '';
    }

    showDanmaku(text, isMe) {
        const container = document.getElementById('danmakuContainer');
        const item = document.createElement('div');
        item.className = 'danmaku-item';
        item.innerText = text;
        item.style.top = `${Math.random() * 80}%`; // Random height
        item.style.color = isMe ? 'var(--p1-color)' : '#fff';

        container.appendChild(item);

        // Remove after animation
        setTimeout(() => {
            item.remove();
        }, 8000);
    }

    // --- Game Logic ---

    handleCellClick(x, y) {
        if (!this.gameActive) return;

        // Online check: Is it my turn?
        if (this.isOnline && this.currentPlayer !== this.myPlayerNum) return;

        // Skill Handling
        if (this.activeSkill === 'destroy') {
            this.executeDestroy(x, y);
            return;
        }
        if (this.activeSkill === 'swap') {
            this.executeSwap(x, y);
            return;
        }

        // Normal Move
        if (this.board[y][x] !== 0) return;

        this.placeStone(x, y, this.currentPlayer);

        // Emit Move
        if (this.isOnline) {
            this.socket.emit('game_move', { roomId: this.roomId, x, y, player: this.currentPlayer });
        }

        if (this.checkWin(x, y, this.currentPlayer)) {
            this.endGame(this.currentPlayer);
            return;
        }

        if (this.doubleMoveRemaining > 0) {
            this.doubleMoveRemaining--;
            if (this.doubleMoveRemaining === 0) {
                this.endTurn();
            }
        } else {
            this.endTurn();
        }
    }

    receiveMove(data) {
        // Opponent placed a stone
        this.placeStone(data.x, data.y, data.player);

        if (this.checkWin(data.x, data.y, data.player)) {
            this.endGame(data.player);
            return;
        }

        // Note: Double move logic needs to be synced or inferred.
        // For simplicity, we assume opponent handles their own turn logic and we just reflect moves.
        // But we need to know when turn ends.
        // Actually, simpler: The server/opponent says "I moved".
        // If it was a double move, they will send 2 moves.
        // We need to know when to switch turn.
        // Let's rely on the standard turn switch unless we implement complex sync.
        // Fix: We will switch turn ONLY if we know it's time.
        // For now, let's just switch turn after every move unless told otherwise?
        // No, double move breaks that.
        // Improved: We just update board. The turn switch should happen locally based on logic?
        // No, easier: Opponent sends "end_turn" event? Or we just mirror logic.
        // Let's mirror logic:

        // If opponent used double move, they would have emitted a skill event first.

        if (this.doubleMoveRemaining > 0) {
            this.doubleMoveRemaining--;
            if (this.doubleMoveRemaining === 0) {
                this.endTurn();
            }
        } else {
            this.endTurn();
        }
    }

    receiveSkill(data) {
        // Opponent used a skill
        const player = this.players[data.player];
        player.energy -= data.cost;

        if (data.skill === 'double') {
            this.doubleMoveRemaining = 2;
        } else if (data.skill === 'destroy') {
            this.board[data.y][data.x] = 0;
            this.renderCell(data.x, data.y);
            this.endTurn();
        } else if (data.skill === 'swap') {
            this.board[data.y][data.x] = data.player;
            this.renderCell(data.x, data.y);
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
        this.renderCell(x, y);
    }

    renderCell(x, y) {
        const index = y * this.boardSize + x;
        const cell = document.getElementById('gameBoard').children[index];
        cell.innerHTML = '';

        const val = this.board[y][x];
        if (val !== 0) {
            const stone = document.createElement('div');
            stone.className = `stone p${val}`;
            cell.appendChild(stone);
        }
    }

    activateSkill(skillName) {
        if (!this.gameActive) return;
        // Online check
        if (this.isOnline && this.currentPlayer !== this.myPlayerNum) return;

        if (this.activeSkill === skillName) {
            this.cancelSkill();
            return;
        }

        const player = this.players[this.currentPlayer];
        let cost = 0;

        switch (skillName) {
            case 'double': cost = 4; break;
            case 'destroy': cost = 3; break;
            case 'swap': cost = 2; break;
        }

        if (player.energy >= cost) {
            this.activeSkill = skillName;

            if (skillName === 'double') {
                player.energy -= cost;
                this.doubleMoveRemaining = 2;
                this.activeSkill = null;

                if (this.isOnline) {
                    this.socket.emit('game_skill', { roomId: this.roomId, skill: 'double', cost, player: this.currentPlayer });
                }
                this.updateUI();
            }

            this.updateUI();
        }
    }

    executeDestroy(x, y) {
        if (this.board[y][x] === 0) return;

        this.players[this.currentPlayer].energy -= 3;
        this.board[y][x] = 0;
        this.renderCell(x, y);

        if (this.isOnline) {
            this.socket.emit('game_skill', { roomId: this.roomId, skill: 'destroy', cost: 3, x, y, player: this.currentPlayer });
        }

        this.activeSkill = null;
        this.endTurn();
    }

    executeSwap(x, y) {
        const targetVal = this.board[y][x];
        if (targetVal === 0 || targetVal === this.currentPlayer) return;

        this.players[this.currentPlayer].energy -= 2;
        this.board[y][x] = this.currentPlayer;
        this.renderCell(x, y);

        if (this.isOnline) {
            this.socket.emit('game_skill', { roomId: this.roomId, skill: 'swap', cost: 2, x, y, player: this.currentPlayer });
        }

        if (this.checkWin(x, y, this.currentPlayer)) {
            this.endGame(this.currentPlayer);
            return;
        }

        this.activeSkill = null;
        this.endTurn();
    }

    cancelSkill() {
        this.activeSkill = null;
        this.updateUI();
    }

    endTurn() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;

        const player = this.players[this.currentPlayer];
        if (player.energy < player.maxEnergy) {
            player.energy++;
        }

        this.updateUI();
    }

    updateUI() {
        const indicator = document.getElementById('turnIndicator');
        indicator.innerText = `玩家 ${this.currentPlayer} 回合`;
        indicator.style.color = this.currentPlayer === 1 ? 'var(--p1-color)' : 'var(--p2-color)';
        indicator.style.borderColor = this.currentPlayer === 1 ? 'var(--p1-color)' : 'var(--p2-color)';

        document.getElementById('p1Panel').classList.toggle('active', this.currentPlayer === 1);
        document.getElementById('p2Panel').classList.toggle('active', this.currentPlayer === 2);

        // Update Names
        if (this.isOnline) {
            if (this.myPlayerNum === 1) {
                document.getElementById('p1Name').innerText = `${this.myNickname} (你)`;
                document.getElementById('p2Name').innerText = `${this.opponentNickname} (对手)`;
            } else {
                document.getElementById('p1Name').innerText = `${this.opponentNickname} (对手)`;
                document.getElementById('p2Name').innerText = `${this.myNickname} (你)`;
            }
        } else {
            document.getElementById('p1Name').innerText = '玩家 1';
            document.getElementById('p2Name').innerText = '玩家 2';
        }

        this.updateEnergyBar(1);
        this.updateEnergyBar(2);

        this.updateSkillButtons(1);
        this.updateSkillButtons(2);
    }

    updateEnergyBar(playerNum) {
        const player = this.players[playerNum];
        const fill = document.getElementById(`p${playerNum}EnergyFill`);
        const text = document.getElementById(`p${playerNum}EnergyText`);

        const pct = (player.energy / player.maxEnergy) * 100;
        fill.style.width = `${pct}%`;
        text.innerText = `${player.energy}/${player.maxEnergy} 能量`;
    }

    updateSkillButtons(playerNum) {
        const player = this.players[playerNum];
        // Only enable buttons if it's THIS player's turn AND (Local Play OR It's MY client's turn)
        const isTurn = this.currentPlayer === playerNum;
        const isMyClient = !this.isOnline || this.myPlayerNum === playerNum;

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

    endGame(winner) {
        this.gameActive = false;
        const overlay = document.getElementById('winOverlay');
        const text = document.getElementById('winnerText');

        text.innerText = `玩家 ${winner} 获胜!`;
        text.style.background = winner === 1
            ? 'linear-gradient(45deg, var(--p1-color), #fff)'
            : 'linear-gradient(45deg, var(--p2-color), #fff)';
        text.style.webkitBackgroundClip = 'text';

        overlay.classList.remove('hidden');
    }

    restart(isRemote = false) {
        if (this.isOnline && !isRemote) {
            this.socket.emit('game_restart', this.roomId);
        }

        this.gameActive = true;
        this.currentPlayer = 1;
        this.players[1].energy = 0;
        this.players[2].energy = 0;
        this.activeSkill = null;
        this.doubleMoveRemaining = 0;
        this.initBoard();
        this.initUI();

        // If online, we don't show menu again, we just reset board
        if (this.isOnline) {
            document.getElementById('menuOverlay').style.display = 'none';
            document.getElementById('gameArena').classList.remove('blur-bg');
        }

        this.updateUI();
    }
}

const game = new GameState();
