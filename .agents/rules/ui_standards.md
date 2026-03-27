# UI 开发与优化规范 (UI Development Standards)

为了避免棋盘闪烁、布局冲突以及重复开发，后续开发必须遵循以下准则：

## 1. 布局与定位准则 (Positioning & Layout)
- **容器驱动居中**：所有弹窗、遮罩层必须使用 `Flexbox` 或 `Grid` 居中。
  - 父级：`display: flex; justify-content: center; align-items: center;`
  - 子级：**严禁**使用 `top: 50%; left: 50%; transform: translate(-50%, -50%);`。
- **解耦动画与属性**：
  - 定义动画（`@keyframes`）时，仅操作 `scale`、`opacity`、`rotate` 等非定位属性。
  - 避免在动画中硬编码位移（`translate`），确保动画逻辑与布局逻辑互不干扰。

## 2. 渲染性能准则 (Performance & Rendering)
- **严禁全量重绘**：在实时交互区域（如棋盘、列表），禁止直接执行 `container.innerHTML = ''`。
- **增量更新机制**：采用“数据快照对比”或“脏检查”模式。
  - 通过 `dataset` 或类属性存储上一次的 DOM 状态。
  - 仅在状态变更（如数值改变、类型切换）时更新 DOM 内容。
  - 样式变更（如选中高亮）必须通过 `classList.toggle` 实现。

## 3. 代码复用准则 (Reusability)
- **UI 组件化**：
  - 结算弹窗（Game Over Overlay）、数字键盘（Numpad）等具有通用性的 UI 应该由 `PlatformController` 或公共 CSS 提供统一类名，严禁在各游戏 Renderer 中独立实现逻辑。
  - 遵循“遮罩层（Overlay）+ 内容盒（Content Box）”的分离模式。

## 4. 样式冲突预防 (CSS Conflict Prevention)
- **命名空间**：游戏特定的样式应带有前缀（如 `.sudoku-xxx`）。
- **慎用 !important**：除非必须覆盖第三方库，否则严禁使用 `!important`，应通过权重或 BEM 命名法解决冲突。
