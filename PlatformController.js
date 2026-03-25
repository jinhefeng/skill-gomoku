class PlatformController {
    constructor() {
        this.socket = io();
        this.roomId = null;
        this.myNickname = '';
        this.opponentNickname = '';
        this.myPlayerNum = 1;

        this.activeGameRenderer = null;
        this.soundManager = new window.SoundManager();
        
        this.initSocketEvents();
        this.initUIEvents();
        
        const savedName = localStorage.getItem('nickname');
        if (savedName && document.getElementById('nicknameInput')) {
            document.getElementById('nicknameInput').value = savedName;
        }
    }

    initSocketEvents() {
        this.socket.on('waiting_for_match', () => {
            document.getElementById('waitingMsg').classList.remove('hidden');
            document.getElementById('waitingText').innerText = '正在寻找对手...';
        });

        this.socket.on('room_created', (roomId) => {
            document.getElementById('waitingMsg').classList.remove('hidden');
            document.getElementById('roomIdBadge').classList.remove('hidden');
            document.getElementById('waitingText').innerText = '房间创建成功，等待对手加入...';
            document.getElementById('roomIdDisplay').innerText = roomId;
            this.roomId = roomId;
        });

        this.socket.on('error_message', (msg) => { this.showToast(msg, true); });

        // Lobby / Viewport wide events
        this.socket.on('danmaku', (data) => this.showDanmaku(data.message, data.player));
        
        this.socket.on('room_joined_lobby', (data) => {
            this.roomId = data.roomId;
            this.myPlayerNum = data.myPlayerNum;
            this.hideMenu();
            this.enterLobby(data.players);
        });

        this.socket.on('lobby_selections', (selections) => {
            ['gomoku', 'sudoku'].forEach(gameId => {
                const container = document.getElementById(`sel_${gameId}`);
                if (container) container.innerHTML = '';
                const card = document.getElementById(`card_${gameId}`);
                if (card) {
                     card.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                     card.style.boxShadow = 'none';
                }
            });
            for (let pIdx in selections) {
                const gameId = selections[pIdx];
                if (!gameId) continue;
                const container = document.getElementById(`sel_${gameId}`);
                if (container) {
                    const badge = document.createElement('div');
                    const isMe = pIdx == this.myPlayerNum;
                    badge.innerText = isMe ? '已就绪 (你)' : '已就绪 (对手)';
                    badge.style.color = pIdx == 1 ? 'var(--p1-color)' : 'var(--p2-color)';
                    badge.style.fontWeight = 'bold';
                    badge.style.marginTop = '10px';
                    container.appendChild(badge);
                    
                    const card = document.getElementById(`card_${gameId}`);
                    if(card) {
                        card.style.borderColor = pIdx == 1 ? 'var(--p1-color)' : 'var(--p2-color)';
                        card.style.boxShadow = `0 0 15px ${pIdx == 1 ? 'rgba(0, 242, 255, 0.4)' : 'rgba(255, 0, 85, 0.4)'}`;
                    }
                }
            }
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
            document.getElementById('githubFooter').classList.add('hidden');
            document.getElementById('statsWidget').classList.add('hidden');
            document.getElementById('returnLobbyBtn').classList.remove('hidden');
            
            this.soundManager.playGameStart();
            
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
        this.socket.on('game_over', (data) => this.activeGameRenderer?.onGameOver?.(data));
        this.socket.on('opponent_move', (data) => this.activeGameRenderer?.onOpponentMove?.(data));
        this.socket.on('opponent_skill', (data) => this.activeGameRenderer?.onOpponentSkill?.(data));
        this.socket.on('game_restart', (data) => this.activeGameRenderer?.onGameRestart?.(data));
        this.socket.on('restart_request_received', (data) => this.activeGameRenderer?.onRestartRequestReceived?.(data));
        this.socket.on('restart_request_ack', (data) => this.activeGameRenderer?.onRestartRequestAck?.(data));
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
                const modalBody = document.getElementById('modalBody');
                modalBody.innerHTML = '<h3>在线人数历史分布</h3><ul>' + 
                    data.visitHistory.slice().reverse().map(d => `<li>${d.time}: ${d.count} 人</li>`).join('') + '</ul>';
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
        document.querySelector('button[onclick="platform.startRandom()"]').disabled = true;
        this.socket.emit('join_random', name);
    }
    
    createPrivate() {
        const name = this.getNickname();
        if (!name) return;
        this.socket.emit('create_private', name);
    }
    
    joinPrivate() {
        const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
        if(!roomId) return this.showToast('请输入房间号', true);
        const name = this.getNickname();
        if (!name) return;
        this.socket.emit('join_private', {roomId, nickname: name});
    }

    hideMenu() {
        document.getElementById('menuOverlay').classList.add('hidden');
        document.getElementById('gameArena').classList.remove('blur-bg');
        document.getElementById('chatBar').classList.remove('hidden');
    }

    enterLobby(players) {
        document.getElementById('mainTitle').innerText = '🦁 游戏大厅';
        document.getElementById('returnLobbyBtn').classList.add('hidden');
        document.getElementById('turnIndicator').classList.add('hidden');
        document.getElementById('githubFooter').classList.remove('hidden');
        document.getElementById('statsWidget').classList.remove('hidden');
        
        this.mountLobby();
        
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
    
    selectGame(gameId) {
        if (!this.roomId) return this.showToast('不在房间内');
        this.socket.emit('player_select_game', { roomId: this.roomId, gameId });
    }

    mountLobby() {
        if (this.activeGameRenderer) {
            this.activeGameRenderer.destroy();
            this.activeGameRenderer = null;
        }
        
        const boardContainer = document.getElementById('boardContainer');
        boardContainer.innerHTML = `
            <div id="lobbySelector" class="lobby-selector">
                <h2 style="margin-bottom: 20px; color: var(--p1-color);">请选择要游玩的游戏 (双方选择一致即开始)</h2>
                <div class="game-cards">
                    <div class="game-card" id="card_gomoku" onclick="platform.selectGame('gomoku')">
                        <h3>技能五子棋</h3>
                        <p>经典的五子棋结合炫酷技能，连成五子即可获胜</p>
                        <div class="selectors" id="sel_gomoku"></div>
                    </div>
                    <div class="game-card" id="card_sudoku" onclick="platform.selectGame('sudoku')">
                        <h3>对战数独</h3>
                        <p>双人实时数独对决，比拼速度与逻辑</p>
                        <div class="selectors" id="sel_sudoku"></div>
                    </div>
                </div>
            </div>
        `;
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
    
    // Game Event Delegation
    emitGameEvent(event, data) {
        if(this.roomId) {
            data.roomId = this.roomId;
            this.socket.emit(event, data);
        }
    }
}

window.PlatformController = PlatformController;
