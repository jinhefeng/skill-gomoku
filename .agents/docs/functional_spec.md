# 功能说明书 (Functional Spec) - Game Platform

## 1. 通用平台协议 (Foundation Protocols)

### 1.1 空间建立
- `create_private` / `join_random` / `join_private`: 创建/加入一个二人私密空间，建立后强制定向至大厅 (`LOBBY`) 态。对于掉线或离开操作，广播 `opponent_left` 进行 Alert 强打断。

### 1.2 大厅双向锁位共识 (Selections Auto-Mount)
由于双弹窗确认易产生阻塞，引入了高效的双选机制：
1. **`room:player_select_game`**:
   - 参数：`{ gameId: 'sudoku' | 'gomoku' }`
   - 服务器行为：追踪并缓存该玩家在 `room.selections` 的独立选择，并向房间下发新意图 `lobby_selections` 广播。
   - 共识判定：当且仅当两位玩家都已就绪且 `room.selections[1] === room.selections[2]` 时，消耗掉选择锁，强制执行房间状态到 `INGAME` 跃迁并调用具体挂载路由逻辑。

### 1.3 降级与退流流程 (Leave Game Fast-fail)
为了保证玩家的退出自由度，取消了双边协商返回的形式，以快速退出代替。
1. **`room:leave_game_to_lobby`**（请求退回大厅）:
   - 服务器行为：立刻卸载本对局的 `room.engine` 对象资源并降级到 `LOBBY` 状态。
   - 裁决判定：这视同发起者主动投降。向留在原地的另一名玩家只发送胜负通知（带有 `onlyReturnLobby: true` 标志阻断其发起重开），当该玩家结算后点击返回大厅方完成实质平行的会合。

---

## 2. 游戏特定规格

### 2.1 五子棋 (Gomoku)
- 保持现有 15x15 棋盘。
- 将自身专有的能量系统模型与回合倒计时逻辑通过生命周期进行内聚，不暴露任何私有数据给 Controller。

### 2.2 对战数独 (Sudoku)
- 预留挂载节点，共用双排架构。

---

## 3. 持久化数据
- 玩家在同一个私密空间内的多次对局战绩以及大厅发言状态均跟随客户端实例，且具备重进刷新防护机制。
