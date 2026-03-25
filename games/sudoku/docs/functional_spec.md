# 功能说明书: 双人对战数独 (Sudoku)

## 1. 业务逻辑概述
双人竞技数独是一款基于标准数独规则的实时对抗游戏。两名玩家共用一个盘面，通过快速抢填空白格来获取分数。核心在于"正确率"与"反应速度"的平衡。

## 2. 核心特征
### 2.1 实时抢填 (Real-time Competitive Filling)
- **所有权概念**：盘面上的所有空格均为公共区域。
- **抢占原则**：第一个在某一格填入**正确**数字的玩家将永久获得该格的所有权。
- **颜色区分**：
  - 玩家 A (Host) 填入的正确数字显示为蓝色 (--p1-color)。
  - 玩家 B (Guest) 填入的正确数字显示为红色 (--p2-color)。
  - 预设格数字显示为深灰色/白色（跟随主题）。

### 2.2 积分与奖惩 (Scoring System)
- **填对奖励**：填入正确数字，该格获得所有权，玩家得分 +1。
- **填错重罚**：填入错误数字，该格仍保持空白，操作玩家得分 -2（旨在防止盲目猜测）。
- **获胜逻辑**：整盘数独填满后，根据合计得分判定胜负。

### 2.3 难度分级 (Difficulty Levels)
由**首位选择数独的玩家**在大厅卡片中选定难度，后选者被动接受：
- **初级 (Easy)**：已知数字 ~40
- **中级 (Medium)**：已知数字 ~30（默认值）
- **高级 (Hard)**：已知数字 ~22

**协议补充**：`player_select_game` 事件额外携带 `difficulty` 字段 (仅 sudoku 有效)。
服务端在 `room.selections` 中缓存首位选中 sudoku 的玩家所传 difficulty，达成共识后将该 difficulty 传入 engine。

### 2.4 草稿模式 (Draft/Note Mode)
- **机制**：玩家可以在每一格中记录最多 9 个小的备选数字。
- **隐私性**：草稿数据仅存于前端本地内存，不向对手广播。
- **清除**：当某格被确认填入后，该格草稿自动清除。

## 3. 错误反馈系统
- **底色告警**：当填错数字时，该格背景立即变为极淡的红色 (#fff0f0)，持续 800ms 后恢复。
- **无持久化**：错误数字不写入盘面，格子保持空白。

## 4. 关键协议 (通过 handleEvent 路由)

### Client -> Server (socket event: `game_move`)
```
{ roomId, row, col, value }
```

### Client -> Server (socket event: `player_select_game`, 大厅选单阶段)
```
{ roomId, gameId: 'sudoku', difficulty: 'easy'|'medium'|'hard' }
```

### Server -> All (broadcast)
- `game_start`: `{ roomId, gameId:'sudoku', player, opponentNickname, board, difficulty }`
- `sudoku_move_result`: `{ row, col, value, playerNum, correct, scores, owners, remainingCells }`
- `game_over`: `{ winner, score, isDraw }`

## 5. 边缘案例
- **同时填入**：后端 handleEvent 按到达顺序原子化处理，避免竞态条件。
- **断线重连**：目前不做断线续玩，断线即判负离场。
