# 游戏开发文档 (Game Development Guide)

欢迎为本平台开发游戏！为了确保您的游戏能被平台动态加载并正常运行，请遵循以下规范。

## 1. 目录结构

每个游戏应位于 `games/` 下的一个独立文件夹中：

```text
games/
  └── [game_id]/
      ├── manifest.json      # 游戏配置文件 (必须)
      ├── renderer.js       # 前端渲染类 (必须)
      ├── engine.js         # 后端引擎类 (必须)
      ├── style.css         # 游戏专属样式 (可选)
      └── assets/           # 图片、音效等资源 (必须，如果是多媒体资源)
```

## 2. 配置文件 (manifest.json)

```json
{
  "id": "gomoku",
  "name": "技能五子棋",
  "description": "经典的五子棋结合炫酷技能",
  "version": "1.0.0",
  "rendererClass": "GomokuRenderer",
  "engineClass": "GomokuEngine",
  "lobbyConfig": {
    "toggles": [
      { "id": "skillEnabled", "name": "技能模式", "default": true }
    ]
  }
}
```

## 3. 前端开发规范 (renderer.js)

所有的游戏渲染器必须实现以下接口：

### `class GameRenderer`

- **`constructor(platform)`**: 平台会注入 `PlatformController` 实例。
- **`initUI(container)`**: 游戏容器已就绪，请在此挂载 DOM。
- **`onGameStart(data)`**: 游戏正式开始。
- **`onMessage(event, data)`**: 处理自定义消息。
- **`onTimerSync(data)`**: 平台统一触发的计时同步。
- **`onGameOver(data)`**: 游戏结算。
- **`destroy()`**: 清理定时器和全局绑定。

## 4. 后端开发规范 (engine.js)

所有的游戏引擎必须实现以下接口：

### `class GameEngine`

- **`constructor(roomId, context, config)`**: 
  - `roomId`: 房间唯一标识。
  - `context`: 包含 `broadcast(event, data)` 和 `emitTo(id, event, data)`。
  - `config`: 玩家在大厅选定的配置。
- **`init()`**: 初始化游戏逻辑。
- **`addPlayer(playerId, nickname)`**: 玩家加入。
- **`handleEvent(playerId, event, data)`**: 处理前端传来的事件。
- **`destroy()`**: 释放资源。

## 5. 资源隔离 (Resource Isolation)

为了确保各游戏之间不产生资源冲突，必须遵循以下隔离原则：

- ** assets 目录**：所有游戏特有的图片、音效等静态资源，必须放置在 `games/[game_id]/assets/` 目录下。
- ** 路径解析**：游戏引擎或渲染器在请求资源时，应使用相对路径（如 `./assets/icon.png`）。
- ** 样式隔离**：所有的 CSS 类名必须以游戏 ID 为前缀（如 `.gomoku-cell`），严禁修改全局标签样式。
- ** 全局变量隔离**：禁止在 `window` 对象上直接挂载非唯一变量名。推荐格式：`window.[GameId]Renderer = ...`。

## 6. 通信协议

- **平台事件** (禁止修改)：`game_move`, `game_restart_request`, `game_restart_agree`。
- **自定义事件**：可以通过 `game_skill` 或自定义名称发送。
