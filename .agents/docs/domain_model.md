# 领域模型说明 (Domain Model) - Game Platform

## 1. 限界上下文 (Bounded Contexts)

### 1.1 平台底座上下文 (Platform Foundation) - **核心域**
负责建立并维护玩家间的“二人私密空间”，管理房间的生命周期及其内部的大厅/游戏共识。
- **职责**：
  - 管理全栈房间的 `LOBBY` 与 `INGAME` 状态轮转。
  - 处理大厅内双方对于游戏类型的双向暗标选择合并协议（Selections Consensus）。
  - 处理断线重挂及主动弃权直接降级大厅。

### 1.2 游戏引擎上下文 (Game Engines) - **支撑域/多因子**
抽象出通用的引擎接口，支持不同游戏逻辑的热插拔及完全自主的 DOM 绘制能力。
- **Gomoku Engine**: 现有的五子棋逻辑及读秒服务。
- **Sudoku Engine**: 对战数独逻辑储备。

---

## 2. 核心状态机 (Room State Machine)

| 状态 | 说明 | 允许的操作 |
| :--- | :--- | :--- |
| **LOBBY** | 空间已建立，双方均在大厅视口。 | 改变并同步意向游戏 (`player_select_game`)、发大厅公屏弹幕、退出房间。 |
| **INGAME** | 双方意向锁定挂载某款应用后进入游戏。 | 进行游戏内的特定操作、**单方随时弃权并退回大厅 (`leave_game_to_lobby`)**。 |

*注：原有的 `PROPOSING` （协议请求弹窗流）架构被认为是低效的，目前已废弃。改用双向意向对齐自动下沉策略。*

---

## 3. 核心领域对象

### 3.1 实体 (Entities)

- **私密空间 (Room)**: 作为一个持久化容器持久管理两名玩家。
  - `roomId`: 房间号。
  - `state`: `LOBBY` | `INGAME`。
  - `selections`: `Map<PlayerIndex, GameId>` 用于游玩前追踪双方双向高亮的暗标决定。
  - `engine`: 承载具体游戏子实例的对象槽位。

### 3.2 聚合根 (Aggregate Roots)

#### **空间聚合 (RoomLifecycleManager)**
管理两名玩家的连接状态及当前承载的游戏引擎实例。确保在切换游戏时，能够安全地让旧引擎自我销毁 (destroy) 并在物理隔离的大厅后挂载新引擎 (mountEngine)，同时保障任何时期的掉线事件都不会导致子实例引用的越界。
