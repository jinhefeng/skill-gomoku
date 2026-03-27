class GomokuRenderer {
    constructor(platform) {
        this.platform = platform;
        this.boardSize = 15;
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.lastMoves = [];
        this.destroyedMarkers = [];
        this.activeSkill = null;
        
        this.currentTurn = null;
        this.gameActive = false;

        // Expose to window so onclick attributes in HTML work seamlessly
        window.gomoku = this; 
    }
    
    initUI(container) {
        this.container = container;
        
        this.boardElement = document.createElement('div');
        this.boardElement.id = 'gameBoard';
        this.boardElement.className = 'game-board';

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                cell.addEventListener('click', () => this.handleCellClick(x, y));
                this.boardElement.appendChild(cell);
            }
        }
        
        this.container.appendChild(this.boardElement);
        if (this.skillEnabled) {
            this.injectSkills();
        }
    }

    injectSkills() {
        const energyHTML = (pNum) => `
            <div class="energy-bar" style="margin-bottom: 8px;">
                <div class="energy-fill" id="p${pNum}EnergyFill" style="width: 0%"></div>
                <span class="energy-text" id="p${pNum}EnergyText">0/5 能量</span>
            </div>
        `;
        const skillsHTML = `
            <button class="skill-btn" data-skill="double" data-cost="4">
                <span class="skill-icon">🌪️</span>
                <span class="skill-name">飞沙走石</span>
                <span class="skill-cost">4 能量</span>
            </button>
            <button class="skill-btn" data-skill="rebel" data-cost="3">
                <span class="skill-icon">🏔️</span>
                <span class="skill-name">力拔山兮</span>
                <span class="skill-cost">3 能量</span>
            </button>
            <button class="skill-btn" data-skill="destroy" data-cost="2">
                <span class="skill-icon">⏳</span>
                <span class="skill-name">时光倒流</span>
                <span class="skill-cost">2 能量</span>
            </button>
        `;

        const p1Area = document.getElementById('p1GameArea');
        const p2Area = document.getElementById('p2GameArea');
        
        if (p1Area) {
            p1Area.classList.remove('empty');
            p1Area.innerHTML = `${energyHTML(1)}<div class="skills-container empty" id="p1Skills">${skillsHTML}</div>`;
        }
        if (p2Area) {
            p2Area.classList.remove('empty');
            p2Area.innerHTML = `${energyHTML(2)}<div class="skills-container empty" id="p2Skills">${skillsHTML}</div>`;
        }
        
        [1, 2].forEach(pNum => {
            const panel = document.getElementById(`p${pNum}Skills`);
            if(panel) {
                panel.querySelectorAll('.skill-btn').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this.activateSkill(btn.dataset.skill);
                    };
                });
            }
        });
    }
    
    handleCellClick(x, y) {
        if (!this.gameActive || this.currentTurn !== this.platform.myPlayerNum) return;
        
        if (this.activeSkill === 'destroy') {
            this.platform.emitGameEvent('game_skill', { skill: 'destroy', x, y });
            this.activeSkill = null;
            return;
        }
        if (this.activeSkill === 'rebel') {
            this.platform.emitGameEvent('game_skill', { skill: 'rebel', x, y });
            this.activeSkill = null;
            return;
        }

        if (this.board[y][x] !== 0) return;
        if (this.destroyedMarkers.some(m => m.x === x && m.y === y)) return;

        this.platform.emitGameEvent('game_move', { x, y, player: this.platform.myPlayerNum });
    }

    activateSkill(skillName) {
        if (!this.gameActive || this.currentTurn !== this.platform.myPlayerNum) return;
        if (!this.skillEnabled) return;
        if (this.activeSkill === skillName) {
            this.activeSkill = null;
            this.updateSkillButtons();
            return;
        }

        if (skillName === 'double') {
            this.platform.emitGameEvent('game_skill', { skill: 'double', player: this.platform.myPlayerNum });
        } else {
            this.activeSkill = skillName;
            this.updateSkillButtons();
        }
    }

    onGameStart(data) {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.lastMoves = [];
        this.destroyedMarkers = [];
        this.activeSkill = null;
        this.gameActive = true;
        this.currentTurn = data.currentTurn;
        
        // 关键加固：使用更宽泛的布尔转换，并优先信任后端下发的显式状态
        this.skillEnabled = !!data.skillEnabled;
        
        if(data.player) this.platform.myPlayerNum = data.player;
        
        if (data.score) {
            this.score = data.score;
            document.getElementById('p1Score').innerText = this.score[1];
            document.getElementById('p2Score').innerText = this.score[2];
        }
        
        const winOverlay = document.getElementById('winOverlay');
        const gameBoard = document.getElementById('gameBoard');
        if (winOverlay) winOverlay.classList.add('hidden');
        if (gameBoard) gameBoard.classList.remove('blur-bg');
        
        // [新增] 移除可能遗留的结算 overlay (对应数独逻辑)
        const oldOverlay = this.container.querySelector('.sudoku-overlay');
        if (oldOverlay) oldOverlay.remove();
        
        this.startLocalTimer();
        this.updateUI();
        this.reRenderBoard();

        // 显式根据配置注入或清空技能 UI
        const p1Area = document.getElementById('p1GameArea');
        const p2Area = document.getElementById('p2GameArea');
        if (this.skillEnabled) {
            this.injectSkills();
        } else {
            if (p1Area) p1Area.innerHTML = '';
            if (p2Area) p2Area.innerHTML = '';
        }
    }

    startLocalTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (!this.lastTimerData || !this.gameActive) return;
            const elapsed = Math.floor((Date.now() - this.lastTimerData.timestamp) / 1000);
            const timeLeft = Math.max(0, this.lastTimerData.duration - elapsed);
            this.syncTimerUI(this.lastTimerData.currentTurn, timeLeft);
        }, 500);
    }

    onTimerSync(data) {
        this.lastTimerData = data;
        this.currentTurn = data.currentTurn;
        this.destroyedMarkers = data.blockedSpots || [];
        
        // 【加固】每轮同步检查 UI 完整性，防止 DOM 被意外清空
        if (this.skillEnabled && (!document.getElementById('p1Skills') || document.getElementById('p1GameArea').classList.contains('empty'))) {
            this.injectSkills();
        }

        if (this.skillEnabled) {
            this.syncEnergyUI(data.energy);
        }
        this.updateUI();
        this.reRenderBoard();
    }

    syncTimerUI(currentTurn, timeLeft) {
        const p1Timer = document.getElementById('p1Timer');
        const p2Timer = document.getElementById('p2Timer');
        
        if (p1Timer && p2Timer) {
            p1Timer.innerText = timeLeft + 's';
            p2Timer.innerText = timeLeft + 's';
            if (currentTurn === 1) {
                p1Timer.classList.remove('hidden');
                p2Timer.classList.add('hidden');
            } else {
                p2Timer.classList.remove('hidden');
                p1Timer.classList.add('hidden');
            }
        }
    }

    onOpponentMove(data) {
        const { x, y, player } = data;
        this.board[y][x] = player;
        this.platform.soundManager.playPlace();
        this.lastMoves = [{x, y}];
        this.reRenderBoard();
    }

    onOpponentSkill(data) {
        if (!this.skillEnabled) return;
        if (data.skill === 'double') this.platform.soundManager.playSand();
        if (data.skill === 'destroy') {
            this.board[data.y][data.x] = 0;
            this.destroyedMarkers.push({x: data.x, y: data.y});
            this.lastMoves = this.lastMoves.filter(m => m.x !== data.x || m.y !== data.y);
            this.platform.soundManager.playTime();
            this.reRenderBoard();
        }
        if (data.skill === 'rebel') {
            this.board[data.y][data.x] = data.player;
            this.lastMoves = [{x: data.x, y: data.y}];
            this.platform.soundManager.playStrength();
            this.reRenderBoard();
        }
    }

    onGameOver(data) {
        this.gameActive = false;
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        const myPlayer = this.platform.myPlayerNum;
        if (data.winner === myPlayer) this.platform.soundManager.playWin();
        else this.platform.soundManager.playLoss();

        // 更新得分 (如果有)
        if (data.score) {
            const p1s = document.getElementById('p1Score');
            const p2s = document.getElementById('p2Score');
            if (p1s) p1s.innerText = data.score[1];
            if (p2s) p2s.innerText = data.score[2];
        }

        // 移除旧的以防重合
        const old = this.container.querySelector('.sudoku-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.className = 'sudoku-overlay'; 
        overlay.id = 'gomokuGameOverOverlay';
        
        const isOpponentLeft = data.onlyReturnLobby || data.reason === 'opponent_left';
        const resultText = data.winner === myPlayer ? '🎉 你赢了!' : '😢 你输了...';

        overlay.innerHTML = `
            <div class="sudoku-overlay-content">
                <div class="minimize-btn" onclick="gomoku.toggleMinimize()">⎯</div>
                <div class="expand-btn" onclick="gomoku.toggleMinimize()">▢</div>
                <div class="overlay-main-content">
                    <h2>${resultText}</h2>
                    <p class="score-summary">比分: ${data.score[1]} - ${data.score[2]}</p>
                    <div class="overlay-btns" style="margin-top: 20px; display: flex; flex-direction: column; gap: 10px; align-items: center;">
                        ${isOpponentLeft ? '' : '<button id="restartBtn" class="restart-btn">再来一局</button>'}
                        ${isOpponentLeft ? '<button class="menu-btn small" onclick="platform.requestReturnLobby()" style="border:none; background: rgba(255,255,255,0.1)">返回大厅</button>' : ''}
                    </div>
                </div>
                <div class="overlay-minimized-content">
                     <span>${resultText} (比分 ${data.score[1]}:${data.score[2]})</span>
                </div>
            </div>
        `;
        this.container.appendChild(overlay);

        if (!isOpponentLeft) {
            const restartBtn = document.getElementById('restartBtn');
            if (restartBtn) {
                restartBtn.onclick = () => this.requestRestart();
            }
        }
        
        this.updateSkillButtons();
    }

    toggleMinimize() {
        const overlay = document.getElementById('gomokuGameOverOverlay');
        if (overlay) {
            overlay.classList.toggle('minimized');
        }
    }

    onRestartRequestAck() {
        const restartBtn = document.getElementById('restartBtn');
        if (restartBtn) {
           restartBtn.innerText = '等待同意...';
           restartBtn.disabled = true;
        }
    }

    onRestartRequestReceived(data) {
        if (data.initiatorNum === this.platform.myPlayerNum) return;

        const btn = document.getElementById('restartBtn');
        if (btn) {
            btn.innerText = `同意 ${data.nickname} 的重开邀请`;
            btn.disabled = false;
            btn.onclick = () => {
                this.platform.emitGameEvent('game_restart_agree', {});
                btn.innerText = '正在握手...';
                btn.disabled = true;
            }
        }
    }

    onGameRestart(data) {
        this.onGameStart(data);
    }
    
    requestRestart() {
        this.platform.emitGameEvent('game_restart_request', {});
    }

    reRenderBoard() {
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const index = y * this.boardSize + x;
                const cell = this.boardElement.children[index];
                cell.className = 'cell';

                if (this.lastMoves.some(m => m.x === x && m.y === y)) cell.classList.add('last-move');
                if (this.destroyedMarkers.some(m => m.x === x && m.y === y)) cell.classList.add('destroyed-marker');

                let stone = cell.querySelector('.stone');
                const val = this.board[y][x];
                if (val !== 0) {
                    if (!stone) {
                        stone = document.createElement('div');
                        cell.appendChild(stone);
                    }
                    stone.className = `stone p${val}`;
                } else if (stone) {
                    stone.remove();
                }
            }
        }
    }

    syncEnergyUI(energyMap) {
        if (!this.skillEnabled) return;
        this.currentEnergyMap = energyMap;
        const e1 = Math.max(0, energyMap[1]);
        const e2 = Math.max(0, energyMap[2]);
        const p1EnergyFill = document.getElementById('p1EnergyFill');
        const p2EnergyFill = document.getElementById('p2EnergyFill');
        const p1EnergyText = document.getElementById('p1EnergyText');
        const p2EnergyText = document.getElementById('p2EnergyText');

        if (p1EnergyFill) p1EnergyFill.style.width = `${(e1 / 5) * 100}%`;
        if (p2EnergyFill) p2EnergyFill.style.width = `${(e2 / 5) * 100}%`;
        if (p1EnergyText) p1EnergyText.innerText = `${e1}/5 能量`;
        if (p2EnergyText) p2EnergyText.innerText = `${e2}/5 能量`;
    }

    updateUI() {
        const p1Panel = document.getElementById('p1Panel');
        const p2Panel = document.getElementById('p2Panel');
        if (p1Panel) p1Panel.classList.toggle('active', this.currentTurn === 1);
        if (p2Panel) p2Panel.classList.toggle('active', this.currentTurn === 2);
        
        this.updateSkillButtons();
    }
    
    updateSkillButtons() {
        if (!this.skillEnabled) return;

        [1, 2].forEach(pNum => {
            const panel = document.getElementById(`p${pNum}Panel`);
            if(!panel) return;
            
            const buttons = panel.querySelectorAll('.skill-btn');
            if (pNum !== this.platform.myPlayerNum) {
                buttons.forEach(btn => btn.disabled = true);
                return;
            }
            
            const isTurn = this.currentTurn === this.platform.myPlayerNum;
            const myEnergy = this.currentEnergyMap ? (this.currentEnergyMap[this.platform.myPlayerNum] || 0) : 0;
            
            buttons.forEach(btn => {
                const cost = parseInt(btn.dataset.cost);
                btn.disabled = !(isTurn && this.gameActive && myEnergy >= cost);
                if (this.activeSkill === btn.dataset.skill) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        });
    }

    destroy() {
        if(this.timerInterval) clearInterval(this.timerInterval);
        if(this.container) this.container.innerHTML = '';
        this.gameActive = false;
        
        const p1Area = document.getElementById('p1GameArea');
        const p2Area = document.getElementById('p2GameArea');
        if (p1Area) p1Area.innerHTML = '';
        if (p2Area) p2Area.innerHTML = '';
        
        delete window.gomoku;
    }
}
window.GomokuRenderer = GomokuRenderer;
