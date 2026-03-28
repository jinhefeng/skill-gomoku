/**
 * SudokuRenderer - 双人竞技数独前端渲染器
 * 遵循 Renderer Isolation 规范 (engine-architecture.md)
 */
class SudokuRenderer {
    constructor(platform) {
        this.platform = platform;
        this.gameActive = false;

        // 盘面状态
        this.board = [];      // 9x9 当前盘面数字
        this.owners = [];     // 9x9 所有权 (-1=预设, 0=空, 1=P1, 2=P2)
        this.drafts = [];     // 9x9 x Set 草稿 (本地私有)

        // UI 状态
        this.selectedCell = null;  // { row, col }
        this.draftMode = false;
        this.difficulty = 'medium';

        // 计时系统
        this.gameStartTime = null;
        this.timerInterval = null;

        // DOM References
        this.container = null;
        this.boardElement = null;
        this.cells = [];       // 扁平化 81 个 cell DOM 引用
        this.numpadButtons = [];

        // 动画定时器
        this.errorTimers = {};
        
        // Expose to window for onclick
        window.sudoku = this;
    }

    initUI(container) {
        this.container = container;
        this.container.innerHTML = '';

        // 主游戏区
        const wrapper = document.createElement('div');
        wrapper.className = 'sudoku-wrapper';

        // 数独棋盘
        this.boardElement = document.createElement('div');
        this.boardElement.className = 'sudoku-board';
        this.boardElement.id = 'sudokuBoard';

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.className = 'sudoku-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;

                // 3x3 宫格边框区分
                if (c % 3 === 0 && c !== 0) cell.classList.add('block-left');
                if (r % 3 === 0 && r !== 0) cell.classList.add('block-top');

                cell.addEventListener('click', () => this.handleCellClick(r, c));
                this.boardElement.appendChild(cell);
                this.cells.push(cell);
            }
        }

        wrapper.appendChild(this.boardElement);

        // 控制面板 (数字键盘 + 草稿切换)
        const controls = document.createElement('div');
        controls.className = 'sudoku-controls';

        // 数字按钮 1-9
        const numpad = document.createElement('div');
        numpad.className = 'sudoku-numpad';
        for (let n = 1; n <= 9; n++) {
            const btn = document.createElement('button');
            btn.className = 'numpad-btn';
            btn.textContent = n;
            btn.addEventListener('click', () => this.handleNumberInput(n));
            numpad.appendChild(btn);
            this.numpadButtons.push(btn);
        }
        controls.appendChild(numpad);

        // 功能按钮行
        const funcRow = document.createElement('div');
        funcRow.className = 'sudoku-func-row';

        // 草稿切换
        const draftBtn = document.createElement('button');
        draftBtn.className = 'func-btn draft-btn';
        draftBtn.id = 'draftToggle';
        draftBtn.innerHTML = '✏️ 草稿';
        draftBtn.addEventListener('click', () => this.toggleDraftMode());
        funcRow.appendChild(draftBtn);

        // 擦除按钮
        const eraseBtn = document.createElement('button');
        eraseBtn.className = 'func-btn erase-btn';
        eraseBtn.innerHTML = '⌫ 擦除';
        eraseBtn.addEventListener('click', () => this.handleErase());
        funcRow.appendChild(eraseBtn);

        controls.appendChild(funcRow);
        wrapper.appendChild(controls);
        this.container.appendChild(wrapper);
    }

    // ==================== 生命周期事件 ====================

    onGameStart(data) {
        this.gameActive = true;
        this.draftMode = false;
        this.selectedCell = null;
        this.difficulty = data.difficulty || 'medium';
        this.smartAssist = !!data.smartAssist;

        // 初始化盘面
        this.board = data.board.map(row => [...row]);
        this.owners = data.owners ? data.owners.map(row => [...row]) : Array.from({ length: 9 }, () => Array(9).fill(0));
        this.drafts = Array.from({ length: 9 }, () =>
            Array.from({ length: 9 }, () => new Set())
        );

        // 如果没有下发 owners（正常开局），根据 board 标记预设格
        if (!data.owners) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (this.board[r][c] !== 0) {
                        this.owners[r][c] = -1;
                    }
                }
            }
        }

        if (data.score) {
            this.updateScoreUI(data.score);
        }

        // 隐藏可能遗留的 overlay
        const overlay = this.container.querySelector('.sudoku-overlay');
        if (overlay) overlay.remove();

        this.updateDraftModeUI();
        this.renderBoard();
        this.startTimer();
    }

    startTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.gameStartTime = Date.now();
        
        const myPlayerNum = this.platform.myPlayerNum;
        const myTimer = document.getElementById(`p${myPlayerNum}Timer`);
        const oppTimer = document.getElementById(`p${myPlayerNum === 1 ? 2 : 1}Timer`);
        
        if (myTimer) { 
            myTimer.classList.remove('hidden'); 
            myTimer.innerText = '00:00'; 
        }
        if (oppTimer) { 
            oppTimer.classList.add('hidden'); 
        }

        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.gameStartTime) / 1000);
            const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const s = (elapsed % 60).toString().padStart(2, '0');
            const timeStr = `${m}:${s}`;
            if (myTimer) myTimer.innerText = timeStr;
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    onSudokuMoveResult(data) {
        const { row, col, value, playerNum, correct, scores, owners, remainingCells } = data;
        const isMe = (playerNum === this.platform.myPlayerNum);

        if (correct) {
            // 写入盘面
            this.board[row][col] = value;
            this.owners[row][col] = playerNum;

            // 清除该格草稿
            this.drafts[row][col].clear();
            
            // 【新增】自动清理相关格子的草稿
            this.autoClearRelatedDrafts(row, col, value);

            if (isMe) {
                this.playCorrectSound();
            } else {
                this.playOpponentSound();
            }
        } else {
            if (isMe) {
                this.playErrorSound();
                this.showErrorFlash(row, col);
            }
        }

        this.updateScoreUI(scores);
        this.renderBoard();
        
        // 如果当前选中的格子被更新了，或者影响了当前选中的格子，刷新面板
        this.updateNumberPadStatus();
    }

    // 【新增】自动清理关联格子的草稿逻辑
    autoClearRelatedDrafts(row, col, value) {
        // 同行
        for (let c = 0; c < 9; c++) {
            if (c !== col) this.drafts[row][c].delete(value);
        }
        // 同列
        for (let r = 0; r < 9; r++) {
            if (r !== row) this.drafts[r][col].delete(value);
        }
        // 同宫
        const boxR = Math.floor(row / 3) * 3;
        const boxC = Math.floor(col / 3) * 3;
        for (let r = boxR; r < boxR + 3; r++) {
            for (let c = boxC; c < boxC + 3; c++) {
                if (r !== row || c !== col) {
                    this.drafts[r][c].delete(value);
                }
            }
        }
    }

    onTimerSync(data) {
        // 数独无回合计时器，此处留空
    }

    onOpponentMove(data) {
        // 数独通过 sudoku_move_result 处理，此路由留空
    }

    onOpponentSkill(data) {
        // 数独无技能系统
    }

    onGameOver(data) {
        this.gameActive = false;
        this.stopTimer();
        const myPlayer = this.platform.myPlayerNum;

        if (data.isDraw) {
            this.platform.soundManager.playBeep();
        } else if (data.winner === myPlayer) {
            this.platform.soundManager.playWin();
        } else {
            this.platform.soundManager.playLoss();
        }

        // 更新分数
        if (data.score) this.updateScoreUI(data.score);

        // 移除旧 overlay
        const old = this.container.querySelector('.sudoku-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.className = 'sudoku-overlay';
        overlay.id = 'gameOverOverlay';
        let resultText = '';
        if (data.isDraw) {
            resultText = '平局！';
        } else if (data.winner === myPlayer) {
            resultText = '🎉 你赢了！';
        } else {
            resultText = '😢 你输了...';
        }
        const isOpponentLeft = data.reason === 'opponent_left' || data.onlyReturnLobby;
        
        overlay.innerHTML = `
            <div class="sudoku-overlay-content">
                <div class="minimize-btn" onclick="sudoku.toggleMinimize()">⎯</div>
                <div class="expand-btn" onclick="sudoku.toggleMinimize()">▢</div>
                <div class="overlay-main-content">
                    <h2>${resultText}</h2>
                    <p class="score-summary">你的得分: ${data.score[myPlayer]} | 对手得分: ${data.score[myPlayer === 1 ? 2 : 1]}</p>
                    ${data.totalTime ? `<p class="time-summary">总耗时: ${Math.floor(data.totalTime / 60)}分${data.totalTime % 60}秒</p>` : ''}
                    <div class="overlay-btns" style="margin-top: 20px; display: flex; flex-direction: column; gap: 10px; align-items: center;">
                        ${isOpponentLeft ? '' : '<button id="sudokuRestartBtn" class="restart-btn">再来一局</button>'}
                        ${isOpponentLeft ? '<button class="menu-btn small" onclick="platform.requestReturnLobby()" style="border:none; background: rgba(255,255,255,0.1)">返回大厅</button>' : ''}
                    </div>
                </div>
                <div class="overlay-minimized-content">
                     <span>${resultText} (${data.score[myPlayer]} : ${data.score[myPlayer === 1 ? 2 : 1]})</span>
                </div>
            </div>
        `;
        this.container.appendChild(overlay);

        if (!isOpponentLeft) {
            const restartBtn = document.getElementById('sudokuRestartBtn');
            if (restartBtn) {
                restartBtn.onclick = () => this.requestRestart();
            }
        }
    }

    toggleMinimize() {
        const overlay = document.getElementById('gameOverOverlay');
        if (overlay) {
            overlay.classList.toggle('minimized');
        }
    }

    onGameRestart(data) {
        this.onGameStart({
            ...data,
            gameId: 'sudoku',
            player: this.platform.myPlayerNum,
            opponentNickname: this.platform.opponentNickname
        });
    }

    onRestartRequestReceived(data) {
        if (data.initiatorNum === this.platform.myPlayerNum) return;
        const btn = document.getElementById('sudokuRestartBtn');
        if (btn) {
            btn.innerText = `同意 ${data.nickname} 的重开邀请`;
            btn.disabled = false;
            btn.onclick = () => {
                this.platform.emitGameEvent('game_restart_agree', {});
                btn.innerText = '正在握手...';
                btn.disabled = true;
            };
        }
    }

    onRestartRequestAck() {
        const btn = document.getElementById('sudokuRestartBtn');
        if (btn) {
            btn.innerText = '等待同意...';
            btn.disabled = true;
        }
    }

    onTurnTimeout() {
        // 数独无回合超时
    }

    requestRestart() {
        this.platform.emitGameEvent('game_restart_request', {});
    }

    // ==================== 交互处理 ====================

    handleCellClick(row, col) {
        if (!this.gameActive) return;
        // 预设格不可编辑, 已被抢占的格也不可再操作
        if (this.owners[row][col] === -1) return;
        if (this.owners[row][col] !== 0) return;

        this.selectedCell = { row, col };
        this.renderBoard();
        this.updateNumberPadStatus();
    }

    handleNumberInput(num) {
        if (!this.gameActive || !this.selectedCell) return;

        const { row, col } = this.selectedCell;

        // 已被占领的不允许操作
        if (this.owners[row][col] !== 0) return;

        if (this.draftMode) {
            // 草稿模式：本地 toggle
            const d = this.drafts[row][col];
            if (d.has(num)) {
                d.delete(num);
            } else {
                d.add(num);
            }
            this.playClickSound();
            this.renderCell(row, col);
        } else {
            // 正式模式：发送给后端
            this.platform.emitGameEvent('game_move', {
                row, col, value: num
            });
        }
    }

    handleErase() {
        if (!this.gameActive || !this.selectedCell) return;
        const { row, col } = this.selectedCell;
        if (this.owners[row][col] !== 0) return;

        this.drafts[row][col].clear();
        this.playClickSound();
        this.renderCell(row, col);
    }

    toggleDraftMode() {
        this.draftMode = !this.draftMode;
        this.playClickSound();
        this.updateDraftModeUI();
    }

    // ==================== 渲染 ====================

    renderBoard() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                this.renderCell(r, c);
            }
        }
    }

    renderCell(row, col) {
        const idx = row * 9 + col;
        const cell = this.cells[idx];
        if (!cell) return;

        const value = this.board[row][col];
        const owner = this.owners[row][col];
        const draft = this.drafts[row][col];

        // 1. 更新类名 (总是执行，开销极小)
        cell.className = 'sudoku-cell';
        if (col % 3 === 0 && col !== 0) cell.classList.add('block-left');
        if (row % 3 === 0 && row !== 0) cell.classList.add('block-top');

        // 选中高亮
        if (this.selectedCell && this.selectedCell.row === row && this.selectedCell.col === col) {
            cell.classList.add('selected');
        }

        // 同行同列同宫背景高亮
        if (this.selectedCell) {
            const sr = this.selectedCell.row, sc = this.selectedCell.col;
            if (row === sr || col === sc ||
                (Math.floor(row / 3) === Math.floor(sr / 3) && Math.floor(col / 3) === Math.floor(sc / 3))) {
                cell.classList.add('highlighted');
            }
        }

        // 2. 脏检查内容：只有内容或所属关系变化时才重绘内容
        // Safari 补强：stateKey 必须包含选中状态(selected)和高亮状态(highlighted)
        // 否则当玩家快速切换格子时，视觉高亮可能由于脏检查返回过快而无法同步
        const isSelected = this.selectedCell && this.selectedCell.row === row && this.selectedCell.col === col;
        const isHighlighted = cell.classList.contains('highlighted');
        const draftStr = Array.from(draft).sort().join(',');
        
        const stateKey = `v:${value}|o:${owner}|d:${draftStr}|s:${isSelected}|h:${isHighlighted}`;
        
        if (cell.dataset.lastState === stateKey) {
            return; // 状态未变，无需重建 innerHTML，避免闪烁
        }
        cell.dataset.lastState = stateKey;

        cell.innerHTML = '';

        if (value !== 0) {
            // 有数字已填入
            const numSpan = document.createElement('span');
            numSpan.className = 'cell-number';
            numSpan.textContent = value;

            if (owner === -1) {
                numSpan.classList.add('preset');
            } else if (owner === 1) {
                numSpan.classList.add('p1-owned');
            } else if (owner === 2) {
                numSpan.classList.add('p2-owned');
            }

            cell.appendChild(numSpan);
        } else if (draft && draft.size > 0) {
            // 显示草稿 (九宫格小数字)
            const draftGrid = document.createElement('div');
            draftGrid.className = 'draft-grid';
            for (let n = 1; n <= 9; n++) {
                const d = document.createElement('span');
                d.className = 'draft-num';
                d.textContent = draft.has(n) ? n : '';
                draftGrid.appendChild(d);
            }
            cell.appendChild(draftGrid);
        }
    }

    updateDraftModeUI() {
        const btn = document.getElementById('draftToggle');
        if (btn) {
            btn.classList.toggle('active', this.draftMode);
        }
        if (this.boardElement) {
            this.boardElement.classList.toggle('draft-mode', this.draftMode);
        }
    }

    // 【新增】更新数字面板的高亮/置灰状态
    updateNumberPadStatus() {
        if (!this.numpadButtons || this.numpadButtons.length === 0) return;
        
        // 使用 requestAnimationFrame 强制 Safari 在下一帧刷新 UI 属性
        // 解决视觉状态切换的“粘滞”或“滞后”问题
        requestAnimationFrame(() => {
            const cell = this.selectedCell;
            
            this.numpadButtons.forEach((btn, index) => {
                const num = index + 1;
                
                // 逻辑增强：
                // 1. 如果处于草稿模式 (Draft Mode)，不进行置灰阻碍，给予玩家绝对自由
                // 2. 如果未选中任何格 (cell 为空)，允许全部点击（引导玩家点选格子）
                // 3. 只有在普通模式 + 开启辅助 + 已选格有效时，才执行冲突检测
                if (this.smartAssist && !this.draftMode && cell) {
                    const isCorrectSpot = (this.owners[cell.row][cell.col] === 0);
                    if (isCorrectSpot && this.isValidPlacement(cell.row, cell.col, num)) {
                        btn.classList.remove('disabled');
                        btn.disabled = false;
                    } else {
                        btn.classList.add('disabled');
                        btn.disabled = true;
                    }
                } else {
                    // 非辅助模式、草稿模式或未选格：全部可用
                    btn.classList.remove('disabled');
                    btn.disabled = false;
                }
            });

            // 强制读取一次 offsetHeight 强制重绘 (Safari Hack)
            this.numpadButtons[0]?.parentElement?.offsetHeight;
        });
    }

    // 【新增】本地合法性检查逻辑
    isValidPlacement(row, col, num) {
        // 如果该格已有数字
        if (this.board[row][col] !== 0) return false;

        // 检查行
        for (let c = 0; c < 9; c++) {
            if (this.board[row][c] === num) return false;
        }
        // 检查列
        for (let r = 0; r < 9; r++) {
            if (this.board[r][col] === num) return false;
        }
        // 检查宫
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let r = startRow; r < startRow + 3; r++) {
            for (let c = startCol; c < startCol + 3; c++) {
                if (this.board[r][c] === num) return false;
            }
        }
        return true;
    }

    updateScoreUI(scores) {
        // 复用平台公共面板得分
        const ps1 = document.getElementById('p1Score');
        const ps2 = document.getElementById('p2Score');
        if (ps1) ps1.textContent = scores[1];
        if (ps2) ps2.textContent = scores[2];
    }

    showErrorFlash(row, col) {
        const idx = row * 9 + col;
        const cell = this.cells[idx];
        if (!cell) return;

        cell.classList.add('error-flash');
        // 清除该格之前的 timer
        const key = `${row}_${col}`;
        if (this.errorTimers[key]) clearTimeout(this.errorTimers[key]);
        this.errorTimers[key] = setTimeout(() => {
            cell.classList.remove('error-flash');
            delete this.errorTimers[key];
        }, 800);
    }

    // ==================== 音效 ====================

    playCorrectSound() {
        // 清脆叮当
        const sm = this.platform.soundManager;
        sm.resume();
        sm.playTone(880, 'sine', 0.15, 0.25);
        setTimeout(() => sm.playTone(1320, 'sine', 0.1, 0.15), 80);
    }

    playErrorSound() {
        // 低沉错误
        const sm = this.platform.soundManager;
        sm.resume();
        sm.playTone(200, 'sawtooth', 0.3, 0.2);
        setTimeout(() => sm.playTone(150, 'sawtooth', 0.25, 0.15), 100);
    }

    playClickSound() {
        // 轻微按钮声
        const sm = this.platform.soundManager;
        sm.resume();
        sm.playTone(600, 'sine', 0.05, 0.08);
    }

    playOpponentSound() {
        // 短促轻提示
        const sm = this.platform.soundManager;
        sm.resume();
        sm.playTone(1000, 'sine', 0.06, 0.05);
    }

    // ==================== 销毁 ====================

    destroy() {
        this.stopTimer();
        // 清除所有错误闪烁定时器
        for (const key in this.errorTimers) {
            clearTimeout(this.errorTimers[key]);
        }
        this.errorTimers = {};

        if (this.container) this.container.innerHTML = '';
        this.gameActive = false;
        this.cells = [];
        this.numpadButtons = [];



        delete window.sudoku;
    }
}

window.SudokuRenderer = SudokuRenderer;
