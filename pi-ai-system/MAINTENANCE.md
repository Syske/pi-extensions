# pi-ai-system — 维护手册

## 概述

pi-ai-system 是 pi-coding-agent 的工作流编排扩展。它将 OpenSpec 建模为一系列阶段（bootstrap → prepare → spec → dev-setup → develop → review → verify），使用子会话（`ctx.newSession`）在每个阶段运行专用智能体，并持久化会话状态。

- **包名：** `pi-ai-system`
- **位置：** `D:\workspace\ai-workspace\ai-system\.pi\extensions\pi-ai-system\`
- **入口：** `index.ts`
- **依赖：** `@earendil-works/pi-coding-agent`（latest）、`@earendil-works/pi-tui`（latest）
- **构建产物：** `index.js`（由扩展运行时加载）

## 依赖关系

| 扩展 | 位置 | 关系 |
|------|------|------|
| **pi-todo** | `~/.pi/agent/extensions/pi-todo/` | orchestrator 通过 `todo:add` / `todo:rollover` 事件跨扩展通信 |
| **pi-session-memory** | `~/.pi/agent/extensions/pi-session-memory/` | 独立，无直接依赖 |

Todo 功能委托给独立的 **pi-todo** 扩展。orchestrator 不直接管理待办事项，而是通过自定义事件 (todo:add, todo:rollover, todo:complete) 驱动 pi-todo。

## 文件地图

| 文件 | 职责 | 行数 |
|------|------|------|
| `index.ts` | 扩展入口。事件注册、命令（as-init、as-bootstrap、as-dev 等）、LLM 工具（workflow_status）、快捷键、UI 更新。 | ~650 |
| `orchestration-engine.ts` | 阶段编排。阶段前检查、事件发射、提示解析、运行链（runChain / runPhase）、启动/恢复工作空间。 | 301 |
| `workflow-runner.ts` | 子会话执行。每个阶段启动一个 `ctx.newSession`，流式处理消息以解析 TODO_COMPLETE 和 ARTIFACT 令牌。带超时（默认 5 分钟）。 | 89 |
| `session-store.ts` | 会话和配置磁盘持久化。处理 session.json、pi-orchestrator.yaml 并解析自定义路径。 | 120 |
| `prompt-resolver.ts` | 系统提示解析。从 agents/ 加载 markdown 模板，替换 {workspace_path} 等占位符。 | 43 |
| `workspace-guard.ts` | 工作区边界执行。管理 `~/.pi/as-state.json` 中的全局状态，验证 cwd 是否在工作区内。 | 52 |
| `status-footer.ts` | 页脚和小部件渲染。阶段进度条，每轮后更新。 | 51 |
| `types.ts` | 共享类型定义（WorkflowPhase、WorkspaceConfig、SessionState 等）。 | 38 |
| `extension-config.json` | 外部配置。阶段到模型的映射和思考级别配置，可在不修改代码的情况下调整。 | 28 |
| `agents/*.md` | 6 个阶段智能体提示（prepare-agent.md、spec-agent.md、dev-setup-agent.md、develop-agent.md、review-agent.md、verify-agent.md）。每个都包含指令、上下文和 {占位符}。 | 每个约 50-100 |

## 架构

### 数据流

```
用户命令（/as-dev my-workspace task-42）
  ↓
index.ts（解析 args，调用 engine.runPhase）
  ↓
OrchestrationEngine.runPhase（前置检查 → emit(todo:add) → 提示解析）
  ↓
WorkflowRunner.spawn（ctx.newSession + waitForIdle + 令牌解析）
    ↕
  emit(todo:complete, { todoId }) — 子智能体标记完成时触发
  ↓
OrchestrationEngine.persist（更新 session.json + emit(todo:rollover)）
  ↓
index.ts（updateUI）
```

### 事件生命周期

```
resources_discover → 贡献 agents/ 路径
  ↓
session_start → restoreSession + 注册页脚 + updateUI
  ↓
input → 快速查询（status 绕过 LLM）
  ↓
before_agent_start → 将工作流阶段状态注入 systemPrompt
  ↓
（用户运行命令 → runChain/runPhase → WorkflowRunner.spawn）
  ↓
turn_end / agent_settled → updateUI + 页脚渲染
  ↓
session_compact → 压缩后验证 session.json 持久化
  ↓
session_before_switch → 保存 session.json
  ↓
session_before_fork → 保存 session.json
  ↓
session_shutdown → 保存 session.json
```

### 事件处理程序状态

| 事件 | 状态 | 说明 |
|------|------|------|
| `resources_discover` | ✅ | 贡献 agents/ skill paths |
| `input` | ✅ | 处理 `status` 快速查询 |
| `session_start` | ✅ | 恢复会话、注册页脚、加载配置 |
| `session_shutdown` | ✅ | 持久化 session.json |
| `session_compact` | ✅ | 压缩后保存 session.json |
| `session_before_switch` | ✅ | 切换前保存 session.json |
| `session_before_fork` | ✅ | Fork 前保存 session.json |
| `turn_end` | ✅ | 更新 UI + 页脚 |
| `agent_settled` | ✅ | 更新 UI + 页脚 |
| `model_select` | ✅ | 记录模型切换 |
| `thinking_level_select` | ✅ | 记录思考级别切换 |
| `session_info_changed` | ✅ | 更新 UI |
| `project_trust` | ✅ | 自动信任工作区路径 |
| `tool_call` | ✅ | 写/编辑文件前检查工作区边界 |
| `tool_result` | ✅ | 记录写/编辑失败错误 |
| `before_agent_start` | ✅ | 注入工作流状态到 system prompt |

### 状态存储

- **全局：** `~/.pi/as-state.json` — 注册的工作区路径
- **工作区：** `<workspace>/session.json` — 完成阶段、当前阶段、构件
- **工作区：** `<workspace>/pi-orchestrator.yaml` — 路径配置

## 扩展间通信

Orchestrator 通过 pi-coding-agent 事件系统与 **pi-todo** 通信：

| 事件 | 方向 | 数据 |
|------|------|------|
| `todo:add` | orchestrator → pi-todo | `{ category: string, items: string[] }` |
| `todo:rollover` | orchestrator → pi-todo | `{ from: string, to: string }` |
| `todo:complete` | orchestrator → pi-todo | `{ todoId: string }` |

pi-todo 负责所有待办事项的 UI 展示、LLM 工具和持久化。

## 错误隔离

所有事件处理程序都通过 `safe()` / `safeAsync()` 包装器运行，以防止单个处理程序崩溃拖垮整个扩展。

## 外部配置（extension-config.json）

`extension-config.json` 允许在不修改代码的情况下调整阶段行为和模型选择：

- **phaseModels**：每个阶段使用的模型（provider + modelId）
- **phaseThinkingLevels**：每个阶段使用的思考级别

## 命令参考

| 命令 | 描述 | 用法 |
|------|------|------|
| `/as-init [path]` | 初始化全局工作区 | 每个用户仅一次 |
| `/as-bootstrap <name>` | 创建/恢复项目工作区 | 每个工作区一次 |
| `/as-prepare <name>` | 运行准备阶段 | |
| `/as-spec <name>` | 运行规范阶段 | |
| `/as-setup <name>` | 运行开发设置阶段 | |
| `/as-dev <name> <task>` | 运行开发阶段 | 需要 task-id |
| `/as-review <name> <task>` | 运行审查阶段 | 需要 task-id |
| `/as-verify <name> <task>` | 运行验证阶段 | 需要 task-id |
| `/as-run <name> <task>` | 运行完整链（6 个阶段） | 需要 task-id |
| `status` | 快速状态别名 | |

### 修饰符

- `--auto` 标志：跳过阶段前检查和确认。示例：`/as-run my-ws task-42 --auto`

### 快捷键

- `Ctrl+Shift+S` — 显示工作流状态

## 令牌协议（子会话）

`WorkflowRunner` 在子会话消息的文本中扫描解析令牌：

- `[TODO_COMPLETE: <id>]` — 向 pi-todo 发送完成事件
- `[ARTIFACT: <path>]` — 将路径记录为构件

## 开发

### 构建

```bash
cd D:\workspace\ai-workspace\ai-system\.pi\extensions\pi-ai-system
npx tsc   # 编译
```

### 包升级

```bash
cd D:\workspace\ai-workspace\ai-system\.pi\extensions\pi-ai-system
npm update
```
