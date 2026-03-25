# 平台化开发架构规范 (Engine Architecture Guide)

这是一份强制性架构开发规范。在任何涉及新游戏开发、核心业务流更改或引擎接口变动时，必须严格遵守以下准则。

## 1. 游戏引擎接口必须继承与实现
系统中存在的所有游戏模块（如 `gomoku`, `sudoku` 等），其后端核心逻辑必须被封装为一个类，该类必须实现以下 `BaseEngine` 规范：

```javascript
// BaseEngine 规范定义
class BaseEngine {
  /**
   * @param {string} roomId 房间标识
   * @param {object} context 平台注入的上下文依赖封装 (含 emitTo, broadcast)
   */
  constructor(roomId, context) {}

  // 生命周期：初始化状态
  init() {}

  // 玩家管理：当玩家就位时由平台调用
  addPlayer(socketId, nickname) {}
  
  // 玩家管理：断线或离开时的清理
  removePlayer(socketId) {}

  // 事件处理路由：子游戏专属事件（如游戏内落子、技能）的统一入口
  handleEvent(socketId, event, data) {}

  // 生命周期：清理资源（如强制清除各种 setTimeout/setInterval，重置内部状态）
  destroy() {}
}
```
**强制要求**：不允许脱离 `handleEvent` 自行在 `server.js` 层面直接绑定具体业务的 socket 监听。

## 2. 隔离依赖 (Context injection)
子游戏引擎**禁止**直接 require 和调用 `io.emit`、`socket.emit`。所有网络通信必须通过平台方注入的 `context` 对象完成。
- 向房间发广播调用：`this.context.broadcast(event, data)`
- 单点发包调用：`this.context.emitTo(socketId, event, data)`

## 3. 跨房间与大厅状态的隔离
大厅切换、发起游玩请求、退回大厅等通用链路，统归大厅管理器 (RoomLifecycleManager / Platform) 处理。单个游戏引擎**绝对不要**去处理 `player_select_game`, `leave_game_to_lobby` 等通用协议。
引擎内部只需要专注于发出 `game_over` 事件并在收到 `destroy` 指令时安静析构即可。

## 4. 前端渲染器的严格隔离 (Renderer Isolation)
每款游戏（如 `GomokuRenderer.js`）在前端必须实现以下生命周期规范，绝不允许将游戏特有 HTML 留在公共 `index.html` 中：

- **`initUI(container)`**: 挂载期。渲染器必须在平台提供的只读盒子（如 `p1GameArea`, `boardContainer`）内自行 `createElement` 或采用 `innerHTML` 凭空创造所需的子节点（包含棋盘、特定能力的倒计时器、专有能量条等）。
- **心跳托管**: 对于高频 UI 减法（如读秒器），应由渲染器内维护 `setInterval` 消费服务端发来的绝对时间戳（`timer_sync`），严禁依靠公共 Controller 越权代理。
- **`destroy()`**: 宿主级销毁。大厅主动卸载游戏时调用。必须清空并重置挂载在主容器内的全部节点，以及手动 `clearInterval` 中止自身的局部线程。

## 5. 目录规范
- 具体的游戏逻辑必须收拢在 `games/[game-name]/` 目录下。
- 前后端逻辑应当成对放置（如 `games/gomoku/engine.js`, `games/gomoku/renderer.js`）。
