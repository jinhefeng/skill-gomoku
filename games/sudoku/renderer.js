class SudokuRenderer {
    constructor(platform) {
        this.platform = platform;
        this.gameActive = false;
    }

    initUI(container) {
        this.container = container;
        this.container.innerHTML = `<div style="padding:40px; text-align:center; color:white;">
            <h1>对战数独 (Sudoku)</h1>
            <p>游戏内容仍在开发中引擎占位...</p>
        </div>`;
    }

    onGameStart(data) { this.gameActive = true; }
    onTimerSync(data) {}
    onOpponentMove(data) {}
    onOpponentSkill(data) {}
    onGameOver(data) {}
    onGameRestart(data) {}

    destroy() {
        this.container.innerHTML = '';
        this.gameActive = false;
    }
}
window.SudokuRenderer = SudokuRenderer;
