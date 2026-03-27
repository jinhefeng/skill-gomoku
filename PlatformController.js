class PlatformController {
    constructor() {
        this.socket = io();
        this.roomId = null;
        this.myNickname = '';
        this.opponentNickname = '';
        this.myPlayerNum = 1;

        this.activeGameRenderer = null;
        this.soundManager = new window.SoundManager();
        
        // 统计图表
        this.visitChart = null;
        
        this.initSocketEvents();
        this.initUIEvents();

        // 显式初始化数独配置状态，防止与后端同步前出现 undefined 导致的联动 Bug
        this._selectedSudokuDifficulty = 'medium';
        this._smartAssistEnabled = false;
        
        const savedName = localStorage.getItem('nickname');
        if (savedName && document.getElementById('nicknameInput')) {
            document.getElementById('nicknameInput').value = savedName;
        }
    }

    initSocketEvents() {
        this.socket.on('waiting_for_match', () => {
            this.setMenuView('waiting');
            document.getElementById('waitingText').innerText = '正在寻找对手...';
            document.getElementById('roomIdBadge').classList.add('hidden');
        });

        this.socket.on('room_created', (roomId) => {
            this.setMenuView('waiting');
            document.getElementById('roomIdBadge').classList.remove('hidden');
            document.getElementById('waitingText').innerText = '私密房间已就绪';
            document.getElementById('roomIdDisplay').innerText = roomId;
            this.roomId = roomId;
            this.showToast('房间创建成功！');
        });

        this.socket.on('error_message', (msg) => { this.showToast(msg, true); });

        // Lobby / Viewport wide events
        this.socket.on('danmaku', (data) => this.showDanmaku(data.message, data.player));
        
        this.socket.on('room_joined_lobby', (data) => {
            this.roomId = data.roomId;
            this.myPlayerNum = data.myPlayerNum;
            
            // 只有当房间已有对手时才隐藏初始菜单，否则保持在等待视图中展示房号
            if (data.players.length > 1) {
                this.hideMenu();
            }
            
            this.enterLobby(data.players);
            
            // 更新得分面板
            if (data.scores) {
                document.getElementById('p1Score').innerText = data.scores[1] || 0;
                document.getElementById('p2Score').innerText = data.scores[2] || 0;
            }

            // 更新对手离线状态：如果只有 1 人，将对手卡片置灰
            const opponentNum = this.myPlayerNum === 1 ? 2 : 1;
            const opponentActive = data.players.find(p => p.playerNum === opponentNum);
            const pCard = document.querySelector(`.player-panel.p${opponentNum}-panel`);
            if (pCard) {
                if (opponentActive) {
                    pCard.classList.remove('offline');
                    document.getElementById(`p${opponentNum}Name`).innerText = opponentActive.nickname;
                } else {
                    pCard.classList.add('offline');
                    if (data.opponentName) {
                        document.getElementById(`p${opponentNum}Name`).innerText = `${data.opponentName} (离线)`;
                    } else {
                        document.getElementById(`p${opponentNum}Name`).innerText = '等待对手...';
                    }
                }
            }
        });

        this.socket.on('lobby_selections', (data) => {
            this.updateLobbyUI(data);
        });

        this.socket.on('opponent_offline', (data) => {
            this.showToast(data.message);
            // 对方卡片置灰
            const opponentNum = data.playerNum;
            const pCard = document.querySelector(`.player-panel.p${opponentNum}-panel`);
            if (pCard) {
                pCard.classList.add('offline');
                const nameNode = document.getElementById(`p${opponentNum}Name`);
                if (nameNode) nameNode.innerText += ' (离线)';
            }
            
            // 更新积分（在只有 1 人时显示最新积分）
            if (data.scores) {
                document.getElementById('p1Score').innerText = data.scores[1] || 0;
                document.getElementById('p2Score').innerText = data.scores[2] || 0;
            }

            // 重置大厅 UI 为初始状态，等待新匹配
            this.mountLobby(); 
        });

        this.socket.on('game_proposal_received', (data) => {
            const targetGameName = data.gameId === 'gomoku' ? '技能五子棋' : '对战数独';
            document.getElementById('switchModalTitle').innerText = '🎮 对战请求';
            document.getElementById('switchText').innerHTML = `对手想邀请您一起玩 <strong>${targetGameName}</strong>，是否接受？`;
            document.getElementById('switchModal').classList.remove('hidden');
            
            this.respondSwitch = (accepted) => {
                document.getElementById('switchModal').classList.add('hidden');
                if(accepted) this.socket.emit('agree_start_game', { roomId: this.roomId, gameId: data.gameId });
            };
        });

        this.socket.on('return_lobby_received', (data) => {
            document.getElementById('switchModalTitle').innerText = '🚪 返回大厅请求';
            document.getElementById('switchText').innerHTML = `对手提议退出当前游戏，共同返回大厅。是否接受？`;
            document.getElementById('switchModal').classList.remove('hidden');
            
            this.respondSwitch = (accepted) => {
                document.getElementById('switchModal').classList.add('hidden');
                if(accepted) this.socket.emit('agree_return_lobby', { roomId: this.roomId });
            };
        });

        this.socket.on('returned_to_lobby', (data) => {
            this.showToast(data.message || '已返回大厅');
            this.enterLobby(data.players);
        });

        // Game Starts logic
        this.socket.on('game_start', (data) => {
            this.roomId = data.roomId;
            this.myPlayerNum = data.player;
            this.opponentNickname = data.opponentNickname;
            
            this.hideMenu();
            if (document.getElementById('githubFooter')) document.getElementById('githubFooter').classList.add('hidden');
            if (document.getElementById('statsWidget')) document.getElementById('statsWidget').classList.add('hidden');
            document.getElementById('returnLobbyBtn').classList.remove('hidden');
            
            this.soundManager.playGameStart();
            
            // 标记本地玩家卡片
            const myPanel = document.getElementById(`p${this.myPlayerNum}Panel`);
            const oppPanel = document.getElementById(`p${this.myPlayerNum === 1 ? 2 : 1}Panel`);
            if (myPanel) myPanel.classList.add('is-me');
            if (oppPanel) oppPanel.classList.remove('is-me');
            
            document.getElementById('p1Name').innerText = this.myPlayerNum === 1 ? `${this.myNickname} (你)` : this.opponentNickname;
            document.getElementById('p2Name').innerText = this.myPlayerNum === 2 ? `${this.myNickname} (你)` : this.opponentNickname;

            const gameId = data.gameId || 'gomoku';
            if (!this.activeGameRenderer || this.activeGameRenderer.constructor.name !== (gameId === 'gomoku' ? 'GomokuRenderer' : 'SudokuRenderer')) {
                this.mountGame(gameId);
            }
            this.activeGameRenderer.onGameStart(data);
        });

        // Event routing into Renderers
        this.socket.on('turn_timeout', (data) => this.activeGameRenderer?.onTurnTimeout?.(data));
        this.socket.on('timer_sync', (data) => this.activeGameRenderer?.onTimerSync?.(data));
        this.socket.on('game_over', (data) => {
            this.activeGameRenderer?.onGameOver?.(data);
        });
        this.socket.on('opponent_move', (data) => this.activeGameRenderer?.onOpponentMove?.(data));
        this.socket.on('opponent_skill', (data) => this.activeGameRenderer?.onOpponentSkill?.(data));
        this.socket.on('game_restart', (data) => {
            this.activeGameRenderer?.onGameRestart?.(data);
        });
        this.socket.on('restart_request_received', (data) => this.activeGameRenderer?.onRestartRequestReceived?.(data));
        this.socket.on('restart_request_ack', (data) => this.activeGameRenderer?.onRestartRequestAck?.(data));
        // Sudoku-specific events
        this.socket.on('sudoku_move_result', (data) => this.activeGameRenderer?.onSudokuMoveResult?.(data));
        this.socket.on('opponent_left', () => {
            this.showToast('对手已离开房间！', true);
            alert('对手已断开连接！游戏结束。');
            location.reload();
        });
        
        // Stats handling
        this.socket.on('stats_update', (data) => {
            document.getElementById('onlineCount').innerText = data.onlineCount;
            document.getElementById('totalVisits').innerText = data.totalVisits;
            if (!document.getElementById('statsModal').classList.contains('hidden')) {
                this.updateVisitChart(data.visitHistory);
            }
        });
    }

    initUIEvents() {
        if(document.getElementById('chatInput')) {
            document.getElementById('chatInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendDanmaku();
            });
        }
        if(document.getElementById('roomIdInput')) {
            document.getElementById('roomIdInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.joinPrivate();
            });
        }
        
        // Expose global methods for html inline onclick events
        window.platform = this;
    }
    
    getNickname() {
        let name = document.getElementById('nicknameInput').value.trim();
        if (!name) {
            this.showToast('请输入你的昵称 (必填)', true);
            return null;
        }
        localStorage.setItem('nickname', name);
        this.myNickname = name;
        return name;
    }

    // Lobby connections
    startRandom() {
        const name = this.getNickname();
        if (!name) return;
        const btn = document.getElementById('startRandomBtn');
        if (btn) btn.disabled = true;
        this.socket.emit('join_random', name);
    }
    
    createPrivate() {
        const name = this.getNickname();
        if (!name) return;
        this.showToast('正在准备私密房间...');
        this.socket.emit('create_private', name);
    }
    
    joinPrivate() {
        const input = document.getElementById('roomIdInput');
        const roomId = input.value.trim().toUpperCase();
        if(!roomId) return this.showToast('请输入 6 位房间号', true);
        const name = this.getNickname();
        if (!name) return;
        this.showToast('正在加入房间...');
        this.socket.emit('join_private', {roomId, nickname: name});
    }

    cancelMatching() {
        this.socket.emit('leave_queue');
        this.setMenuView('initial');
        const btn = document.getElementById('startRandomBtn');
        if (btn) btn.disabled = false;
        this.showToast('匹配已取消');
    }

    setMenuView(view) {
        if (view === 'waiting') {
            document.getElementById('menuInitialView').classList.add('hidden');
            document.getElementById('menuWaitingView').classList.remove('hidden');
        } else {
            document.getElementById('menuInitialView').classList.remove('hidden');
            document.getElementById('menuWaitingView').classList.add('hidden');
        }
    }

    hideMenu() {
        document.getElementById('menuOverlay').classList.add('hidden');
        document.getElementById('gameArena').classList.remove('blur-bg');
        document.getElementById('chatBar').classList.remove('hidden');
        // 游戏开始，移除大厅状态类，标题上移
        const container = document.querySelector('.app-container');
        if (container) container.classList.remove('in-lobby');
    }

    enterLobby(players) {
        // 进入大厅，增加状态类，标题下移
        const container = document.querySelector('.app-container');
        if (container) container.classList.add('in-lobby');
        
        document.getElementById('mainTitle').innerText = '🦁 游戏大厅';
        document.getElementById('returnLobbyBtn').classList.add('hidden');
        document.getElementById('turnIndicator').classList.add('hidden');
        document.getElementById('githubFooter').classList.remove('hidden');
        document.getElementById('statsWidget').classList.remove('hidden');
        
        this.mountLobby();
        this.resetTimerUI();
        
        // 标记本地玩家卡片
        const myPanel = document.getElementById(`p${this.myPlayerNum}Panel`);
        const oppPanel = document.getElementById(`p${this.myPlayerNum === 1 ? 2 : 1}Panel`);
        if (myPanel) myPanel.classList.add('is-me');
        if (oppPanel) oppPanel.classList.remove('is-me');
        
        const me = players.find(p => p.playerNum === this.myPlayerNum);
        const opp = players.find(p => p.playerNum !== this.myPlayerNum);
        this.myNickname = me.nickname;
        this.opponentNickname = opp ? opp.nickname : '等待中...';
        
        document.getElementById('p1Name').innerText = this.myPlayerNum === 1 ? `${this.myNickname} (你)` : this.opponentNickname;
        document.getElementById('p2Name').innerText = this.myPlayerNum === 2 ? `${this.myNickname} (你)` : this.opponentNickname;

        document.getElementById('p1Score').innerText = '0';
        document.getElementById('p2Score').innerText = '0';
    }

    // Danmaku System
    sendDanmaku() {
        const input = document.getElementById('chatInput');
        const msg = input.value.trim();
        if(!msg) return;
        
        this.showDanmaku(msg, this.myPlayerNum);
        
        if(this.roomId) {
            this.socket.emit('danmaku', { roomId: this.roomId, message: msg, player: this.myPlayerNum });
        }
        input.value = '';
    }
    
    showDanmaku(text, playerNum) {
        const container = document.getElementById('danmakuContainer');
        const item = document.createElement('div');
        item.className = 'danmaku-item';
        item.innerText = text;
        item.style.top = `${Math.random() * 80}%`;
        const duration = 5 + Math.random() * 7;
        item.style.animation = `fly ${duration}s linear forwards`;
        if(playerNum === 1) {
            item.style.color = 'var(--p1-color)';
            item.style.textShadow = '0 0 5px var(--p1-glow)';
        } else {
            item.style.color = 'var(--p2-color)';
            item.style.textShadow = '0 0 5px var(--p2-glow)';
        }
        container.appendChild(item);
        setTimeout(() => item.remove(), duration * 1000);
    }
    
    selectGame(gameId, difficulty) {
        if (!this.roomId) return this.showToast('不在房间内');
        const payload = { roomId: this.roomId, gameId };
        if (difficulty) payload.difficulty = difficulty;
        this.socket.emit('player_select_game', payload);
    }

    // 数独：点击难度按钮即选择游戏，并允许反复点击切换难度
    selectSudokuDifficulty(diff) {
        this._selectedSudokuDifficulty = diff;
        this.syncSudokuConfig();
    }

    // 【新增】切换智能辅助
    toggleSmartAssist(event) {
        if (event) event.stopPropagation(); 
        // 增加权限初步判定，只有在是 Owner 的潜在状态下才允许本地翻转
        this._smartAssistEnabled = !this._smartAssistEnabled;
        this.syncSudokuConfig();
    }

    // 【新增】同步数独配置（难度+辅助）
    syncSudokuConfig() {
        // 关键修复：确保 smartAssist 永远是布尔值 false/true，而不是 undefined，防止发给服务器的数据导致逻辑跳变
        const payload = { 
            roomId: this.roomId, 
            gameId: 'sudoku', 
            difficulty: this._selectedSudokuDifficulty || 'medium',
            smartAssist: !!this._smartAssistEnabled
        };
        this.socket.emit('player_select_game', payload);
    }

    // 数独：确认选择游戏
    confirmSudoku() {
        const diff = this._selectedSudokuDifficulty || 'medium';
        this._sudokuSelected = true;
        this.selectGame('sudoku', diff);
    }

    mountLobby() {
        if (this.activeGameRenderer) {
            this.activeGameRenderer.destroy();
            this.activeGameRenderer = null;
        }

        // 大厅挂载时，强制初始化配置变量为默认值或现有值
        this._selectedSudokuDifficulty = this._selectedSudokuDifficulty || 'medium';
        this._smartAssistEnabled = !!this._smartAssistEnabled;
        
        // 移除盲目重置，状态应由服务器下发的 gameConfigs 驱动
        
        boardContainer.innerHTML = `
            <div id="lobbySelector" class="lobby-selector">
                <h2 style="margin-bottom: 20px; color: var(--p1-color); font-size: 1.2rem;">请选择游戏</h2>
                <div class="game-cards">
                    <div class="game-card" id="card_gomoku" onclick="platform.selectGame('gomoku')">
                        <div class="card-content">
                            <h3>技能五子棋</h3>
                            <p>经典的五子棋结合炫酷技能</p>
                            <div id="sel_gomoku" class="selection-badges"></div>
                        </div>
                    </div>
                    <div class="game-card" id="card_sudoku" onclick="platform.selectGame('sudoku')">
                        <div class="card-content">
                            <h3 style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <span>对战数独</span>
                                <span id="smartAssistBulb" class="assist-bulb" onclick="platform.toggleSmartAssist(event)" title="智能候选辅助">💡</span>
                            </h3>
                            <p>实时对决，比拼逻辑</p>
                            <div id="sel_sudoku" class="selection-badges"></div>
                            
                            <div class="sudoku-config-zone" onclick="event.stopPropagation()">
                                <div class="difficulty-btns" id="difficultyBtns" onclick="event.stopPropagation()">
                                    <button class="diff-btn" data-diff="easy" onclick="platform.selectSudokuDifficulty('easy')">初</button>
                                    <button class="diff-btn" data-diff="medium" onclick="platform.selectSudokuDifficulty('medium')">中</button>
                                    <button class="diff-btn" data-diff="hard" onclick="platform.selectSudokuDifficulty('hard')">高</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    updateLobbyUI(data) {
        const selections = data.selections;
        const gameConfigs = data.gameConfigs || {};

        // 1. 处理卡片选中高亮
        const cards = document.querySelectorAll('.game-card');
        cards.forEach(c => {
            const gameId = c.id.replace('card_', '');
            c.classList.remove('p1-selected', 'p2-selected');
            
            if (selections[1] === gameId) c.classList.add('p1-selected');
            if (selections[2] === gameId) c.classList.add('p2-selected');
        });

        // 2. 更新数独配置与权限控制
        const sudokuConfig = gameConfigs.sudoku || { difficulty: 'medium', smartAssist: false, owner: null };
        const isOwner = sudokuConfig.owner === this.myPlayerNum;

        // 只有当前玩家是数独的选择者（Owner）时，才允许修改按钮
        this._selectedSudokuDifficulty = sudokuConfig.difficulty;
        document.querySelectorAll('.diff-btn').forEach(btn => {
            const active = btn.dataset.diff === sudokuConfig.difficulty;
            btn.classList.toggle('active', active);
            btn.disabled = !isOwner;
            btn.classList.toggle('locked', !isOwner);
        });

        this._smartAssistEnabled = sudokuConfig.smartAssist;
        const bulb = document.getElementById('smartAssistBulb');
        if (bulb) {
            bulb.classList.toggle('active', sudokuConfig.smartAssist);
            bulb.classList.toggle('locked', !isOwner);
        }
    }

    // Dynamic Engine Mounting
    mountGame(gameId) {
        if (this.activeGameRenderer) {
            this.activeGameRenderer.destroy();
        }
        const arena = document.getElementById('boardContainer');
        arena.innerHTML = ''; 

        if (gameId === 'gomoku') {
            document.getElementById('mainTitle').innerText = '技能五子棋';
            this.activeGameRenderer = new window.GomokuRenderer(this);
        } else if (gameId === 'sudoku') {
            document.getElementById('mainTitle').innerText = '对战数独';
            this.activeGameRenderer = new window.SudokuRenderer(this);
        }
        this.activeGameRenderer.initUI(arena);
    }

    requestStartGame(gameId) {
        if (!this.roomId) return this.showToast('不在房间内');
        this.socket.emit('request_start_game', { roomId: this.roomId, gameId });
        this.showToast('已向对手发出游戏邀请');
    }

    requestReturnLobby() {
        if (!this.roomId) return;
        this.socket.emit('leave_game_to_lobby', { roomId: this.roomId });
    }
    
    respondSwitch(accepted) {
        // Will be dynamically reassigned when receive modal
    }
    
    // Global Dashboard Features
    showVisitHistory() {
        document.getElementById('statsModal').classList.remove('hidden');
        this.socket.emit('get_stats');
        
        // 如果 Chart.js 已加载，稍后会在 stats_update 中更新
        // 这里可以先显示一个加载状态
        const ctx = document.getElementById('visitChart');
        if (ctx && !this.visitChart) {
            ctx.getContext('2d').font = '14px Outfit';
            ctx.getContext('2d').fillStyle = '#fff';
            ctx.getContext('2d').fillText('加载中...', 10, 30);
        }
    }

    updateVisitChart(history) {
        const ctx = document.getElementById('visitChart');
        if (!ctx || !window.Chart) return;

        const labels = history.map(d => d.time);
        const counts = history.map(d => d.count);

        if (this.visitChart) {
            this.visitChart.data.labels = labels;
            this.visitChart.data.datasets[0].data = counts;
            this.visitChart.update();
        } else {
            this.visitChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '访问人数',
                        data: counts,
                        borderColor: '#00f2ff',
                        backgroundColor: 'rgba(0, 242, 255, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#00f2ff',
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            titleColor: '#00f2ff',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: 'rgba(255, 255, 255, 0.5)', maxRotation: 45, minRotation: 45 }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: 'rgba(255, 255, 255, 0.5)' }
                        }
                    }
                }
            });
        }
    }
    
    copyRoomId() {
        navigator.clipboard.writeText(this.roomId).then(() => this.showToast('房间号已复制'));
    }
    
    // Global UI Feedback
    showToast(msg, isError = false) {
        const toast = document.getElementById('globalToast');
        if (!toast) return;
        toast.innerText = msg;
        if (isError) {
            toast.classList.add('error');
        } else {
            toast.classList.remove('error');
        }
        toast.classList.remove('hidden');
        
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 2500);
    }
    
    resetTimerUI() {
        const t1 = document.getElementById('p1Timer');
        const t2 = document.getElementById('p2Timer');
        if (t1) {
            t1.classList.add('hidden');
            t1.innerText = '00:00';
        }
        if (t2) {
            t2.classList.add('hidden');
            t2.innerText = '00:00';
        }
    }

    // Game Event Delegation
    emitGameEvent(event, data) {
        if(this.roomId) {
            data.roomId = this.roomId;
            this.socket.emit(event, data);
        }
    }
}

window.PlatformController = PlatformController;
