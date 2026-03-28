/**
 * SudokuEngine - 双人竞技数独后端引擎
 * 遵循 BaseEngine 规范 (engine-architecture.md)
 */
class SudokuEngine {
    constructor(roomId, context, config = {}) {
        this.roomId = roomId;
        this.context = context; // { broadcast, emitTo }

        this.players = [];   // [{ id, nickname, player: 1|2 }]
        this.score = { 1: 0, 2: 0 };
        this.gameActive = false;

        // 数独盘面
        this.board = [];     // 9x9 当前盘面 (0 = 空)
        this.solution = [];  // 9x9 唯一解
        this.owners = [];    // 9x9 所有权 (0=预设/空, 1=P1, 2=P2)
        this.totalEmpty = 0; // 需要填的总格数
        this.filledCount = 0;

        this.difficulty = config.difficulty || 'medium';
        this.smartAssist = config.smartAssist || false;
        this.restartRequests = new Set();
        this.gameId = 'sudoku';
    }

    init() {
        // 引擎挂载时调用，此时玩家尚未加入
    }

    addPlayer(socketId, nickname) {
        // 检查是否是重连（已有相同昵称的玩家位，但 socketId 不同）
        const rejoiningPlayer = this.players.find(p => p.nickname === nickname);
        if (rejoiningPlayer) {
            console.log(`SudokuEngine: Player ${nickname} rejoining with new socket ${socketId}`);
            rejoiningPlayer.id = socketId;
            return;
        }

        const playerNum = this.players.length === 0 ? 1 : 2;
        this.players.push({ id: socketId, nickname, player: playerNum });

        if (this.players.length === 2) {
            this.startGame();
        }
    }

    // 获取当前完整快照用于重连同步
    getSyncState() {
        return {
            board: this.board.map(row => [...row]),
            owners: this.owners.map(row => [...row]),
            difficulty: this.difficulty,
            smartAssist: this.smartAssist,
            score: { ...this.score }
        };
    }

    removePlayer(socketId) {
        // 极简方案：断开时不从 players 列表中删除，仅在游戏真的销毁时处理
        // 这样可以保留 pIdx 的映射关系
    }

    startGame() {
        this.generatePuzzle(this.difficulty);
        this.gameActive = true;
        this.score = { 1: 0, 2: 0 };
        this.filledCount = 0;
        this.startTime = Date.now(); // 记录开始时间
        this.restartRequests.clear();

        this.players.forEach(p => {
            const opponent = this.players.find(op => op.id !== p.id);
            this.context.emitTo(p.id, 'game_start', {
                roomId: this.roomId,
                gameId: 'sudoku',
                player: p.player,
                opponentNickname: opponent ? opponent.nickname : 'Opponent',
                board: this.board.map(row => [...row]),
                difficulty: this.difficulty,
                smartAssist: this.smartAssist,
                score: this.score
            });
        });
    }

    handleEvent(socketId, event, data) {
        const playerObj = this.players.find(p => p.id === socketId);
        if (!playerObj) return;

        if (event === 'game_move') {
            this.handleMove(playerObj, data);
        } else if (event === 'game_restart_request') {
            this.handleRestartRequest(socketId);
        } else if (event === 'game_restart_agree') {
            this.handleRestartAgree(socketId);
        }
    }

    handleMove(playerObj, data) {
        if (!this.gameActive) return;

        const { row, col, value } = data;

        // 基本校验
        if (row < 0 || row > 8 || col < 0 || col > 8) return;
        if (value < 1 || value > 9) return;

        // 已被抢占或是预设格
        if (this.owners[row][col] !== 0) return;
        // 该格已有正确答案 (被其他玩家先填了)
        if (this.board[row][col] !== 0) return;

        const correct = (value === this.solution[row][col]);

        if (correct) {
            this.board[row][col] = value;
            this.owners[row][col] = playerObj.player;
            this.score[playerObj.player] += 1;
            this.filledCount++;
        } else {
            this.score[playerObj.player] -= 2;
        }

        const remainingCells = this.totalEmpty - this.filledCount;

        this.context.broadcast('sudoku_move_result', {
            row, col, value,
            playerNum: playerObj.player,
            correct,
            scores: { ...this.score },
            owners: correct ? { row, col, owner: playerObj.player } : null,
            remainingCells
        });

        // 检查是否棋盘填满
        if (remainingCells === 0) {
            this.gameActive = false;
            let winner = 0;
            let isDraw = false;
            if (this.score[1] > this.score[2]) winner = 1;
            else if (this.score[2] > this.score[1]) winner = 2;
            else isDraw = true;

            const totalTime = Math.floor((Date.now() - this.startTime) / 1000);

            this.context.broadcast('game_over', {
                winner,
                score: this.score,
                isDraw,
                totalTime
            });
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
            this.context.broadcast('restart_request_received', {
                nickname: player.nickname,
                initiatorNum: player.player
            });
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
        this.generatePuzzle(this.difficulty);
        this.gameActive = true;
        this.score = { 1: 0, 2: 0 };
        this.filledCount = 0;
        this.restartRequests.clear();

        this.context.broadcast(this.roomId, 'game_restart', {
            board: this.board.map(row => [...row]),
            difficulty: this.difficulty,
            smartAssist: this.smartAssist,
            score: this.score
        });
    }

    destroy() {
        this.gameActive = false;
    }

    // ====================== 数独生成算法 ======================

    /**
     * 生成一个有唯一解的数独谜题
     */
    generatePuzzle(difficulty) {
        // 1. 生成一个完整的合法数独终局
        this.solution = this.generateFullBoard();

        // 2. 根据难度决定保留多少数字（其余挖空）
        const clueCount = this.getClueCount(difficulty);
        this.board = this.solution.map(row => [...row]);
        this.owners = Array.from({ length: 9 }, () => Array(9).fill(0));

        // 3. 挖洞
        this.digHoles(this.board, 81 - clueCount);

        // 4. 标记预设格（board 中非零的格被标记为 owner = -1，表示预设）
        this.totalEmpty = 0;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (this.board[r][c] !== 0) {
                    this.owners[r][c] = -1; // 预设格
                } else {
                    this.totalEmpty++;
                }
            }
        }
    }

    getClueCount(difficulty) {
        switch (difficulty) {
            case 'easy': return 38 + Math.floor(Math.random() * 5);   // 38-42
            case 'medium': return 28 + Math.floor(Math.random() * 5); // 28-32
            case 'hard': return 22 + Math.floor(Math.random() * 4);   // 22-25
            default: return 30;
        }
    }

    /**
     * 使用回溯法生成一个完整的数独终局
     */
    generateFullBoard() {
        const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
        this.fillBoard(grid);
        return grid;
    }

    fillBoard(grid) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    const nums = this.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
                    for (const num of nums) {
                        if (this.isValidPlacement(grid, r, c, num)) {
                            grid[r][c] = num;
                            if (this.fillBoard(grid)) return true;
                            grid[r][c] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    isValidPlacement(grid, row, col, num) {
        // 检查行
        for (let c = 0; c < 9; c++) {
            if (grid[row][c] === num) return false;
        }
        // 检查列
        for (let r = 0; r < 9; r++) {
            if (grid[r][col] === num) return false;
        }
        // 检查 3x3 宫
        const boxR = Math.floor(row / 3) * 3;
        const boxC = Math.floor(col / 3) * 3;
        for (let r = boxR; r < boxR + 3; r++) {
            for (let c = boxC; c < boxC + 3; c++) {
                if (grid[r][c] === num) return false;
            }
        }
        return true;
    }

    /**
     * 挖洞算法：随机移除格子，确保唯一解
     */
    digHoles(board, holesToDig) {
        const cells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                cells.push([r, c]);
            }
        }
        this.shuffle(cells);

        let dug = 0;
        for (const [r, c] of cells) {
            if (dug >= holesToDig) break;

            const backup = board[r][c];
            board[r][c] = 0;

            // 验证唯一解
            if (this.countSolutions(board, 0, 0, 0) !== 1) {
                board[r][c] = backup; // 恢复，这个洞不能挖
            } else {
                dug++;
            }
        }
    }

    /**
     * 快速计数解的数量（最多到 2 就停止）
     */
    countSolutions(grid, row, col, count) {
        if (count > 1) return count; // 提前剪枝

        if (row === 9) return count + 1;

        const nextRow = col === 8 ? row + 1 : row;
        const nextCol = col === 8 ? 0 : col + 1;

        if (grid[row][col] !== 0) {
            return this.countSolutions(grid, nextRow, nextCol, count);
        }

        for (let num = 1; num <= 9; num++) {
            if (this.isValidPlacement(grid, row, col, num)) {
                grid[row][col] = num;
                count = this.countSolutions(grid, nextRow, nextCol, count);
                grid[row][col] = 0;
                if (count > 1) return count;
            }
        }
        return count;
    }

    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

module.exports = SudokuEngine;
