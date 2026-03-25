# 任务列表: skill-gomoku 平台化重构演进

- [x] 第一阶段：项目现状分析与 DDD 文档化 (Completed)
    - [x] 阅读 `README.md` 与核心代码逻辑分析
    - [x] 核查 `.agent/rules/` 规范
    - [x] 制定初步 DDD 实施计划并获准
    - [x] 生成 `/docs/domain_model.md`
    - [x] 生成 `/docs/functional_spec.md`
    - [x] 生成 `/docs/interaction_spec.md`
    - [x] 完成任务总结与影响分析 (Walkthrough)

- [x] 第二阶段：从单游戏向“游戏对战平台”架构升级 (Completed)
    - [x] **2.1 架构设计与共识定义**
        - [x] 编写《架构升级与重构影响分析报告》
        - [x] 定义通用的 `BaseEngine.js` 与 `GameContext` 接口规范
    - [x] **2.2 核心后端重构 (Backend Infrastructure)**
        - [x] 模块化 `GomokuEngine.js` 并从 `server.js` 剥离业务逻辑
        - [x] 封装 `RoomLifecycleManager.js` (负责持久化私密空间)
        - [x] 改造 `server.js` 为通用分发网关
    - [x] **2.3 核心前端重构 (Frontend Interaction)**
        - [x] 抽象 `GomokuRenderer.js` 并建立组件加载机制
        - [x] 适配 `index.html` 以支持多游戏 Viewport 挂载
    - [x] **2.4 游戏大厅独立化与架构剥离 (Lobby Decoupling)**
        - [x] 状态重整：匹配成功进入房间后状态拦截在 `LOBBY`，并构建选单隔离内存。
        - [x] DOM 剥离：清理 `index.html` 中的一切游戏属性假节点（能量条、技能等），改为 `GomokuRenderer` 挂载时按需生成。
        - [x] 大厅双选机制：完全舍弃陈旧的弹窗邀请协议，改为大厅卡片暗标亮起双向确认后自动挂载对局。
        - [x] 一键断流放弃机制：中途点击[返回大厅]即可当场结算认输断挂内存并直接退回。

- [x] 第三阶段：稳定性回归与平台交付 (Completed)
    - [x] 原有五子棋功能、倒计时、能耗系统的渲染生命周期全面找回及验证
    - [x] 大厅返回、直接中断投降、对方异常掉网断联的断言保护及强截流 Alert
    - [x] 排查解决遗漏的事件死锁问题（即重启按钮事件注入时机错误导致的运行时崩溃）

- [x] 第四阶段：规范总结与沉淀 (Completed)
    - [x] 将沉淀出来的引擎设计经验覆写进 `engine-architecture.md` 开发公约
    - [x] 将最新的双向选择模式及时更新到 `domain_model` / `interaction_spec` 中。
