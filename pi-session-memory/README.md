# pi-session-memory

Pi Coding Agent 会话记忆扩展，自动追踪会话中的工具使用、阶段切换和知识模式。

## 安装

全局安装（推荐）：

```bash
cp -r .pi/extensions/pi-session-memory ~/.pi/agent/extensions/
```

项目级安装：

```bash
cp -r .pi/extensions/pi-session-memory ~/.pi/agent/extensions/
```

安装后重启 Pi 或执行 `/reload` 生效。

## 架构

扩展监听 Pi 的完整生命周期事件，将记忆管理分为 4 个维度：

```
工具调用 ← tool_call / tool_result
   ↓
阶段切换 ← model_select / thinking_level_select
   ↓
知识提取 ← turn_start / turn_end / agent_settled
   ↓
持久化   ← session_before_compact / session_shutdown / session_before_switch
```

## 事件处理一览

| 事件 | 作用 | 关键行为 |
|------|------|---------|
| `resources_discover` | 资源发现 | 预留扩展点，可贡献 memory skill 路径 |
| `session_start` | 会话初始化 | 根据 reason（new/resume/fork）恢复或重建记忆状态 |
| `session_shutdown` | 会话结束 | 自动生成总结条目 + 持久化到磁盘 |
| `session_before_compact` | 压缩前回调 | 注入记忆摘要到 compaction summary |
| `session_compact` | 压缩完成 | 清理 1 小时内未见的旧 knowledge 条目 |
| `session_before_tree` | 导航分支前 | 保存记忆状态到 branch summary |
| `session_before_switch` | 切换会话前 | 持久化当前状态到磁盘 |
| `session_before_fork` | Fork 前 | 持久化当前状态到磁盘 |
| `session_info_changed` | 会话重命名 | 通过 EventBus 发射 state-changed 事件 |
| `before_agent_start` | 智能体启动前 | 将已知错误/成功模式注入 system prompt（受配置控制） |
| `turn_start` | 回合开始 | 递增 turn 计数 + 阶段 tool 计数 |
| `turn_end` | 回合结束 | 从 toolResults 补充执行统计 |
| `agent_settled` | 智能体彻底完成 | 自动生成记忆总结条目（受配置控制） |
| `input` | 用户输入 | 支持 `?memory` 和 `?memory <关键词>` 快速查询，不经过 LLM |
| `tool_call` | 工具调用 | 记录工具使用模式（read/write/edit/glob/grep/bash） |
| `tool_result` | 工具结果 | 正则匹配错误模式（ENOENT、permission denied、exit code 等） |
| `model_select` | 模型切换 | 触发阶段追踪 + 可选自动调整 thinking level |
| `thinking_level_select` | 思考层级变化 | 更新状态 + footer status 显示 |

## 命令

| 命令 | 描述 |
|------|------|
| `/memory-scan` | 扫描当前会话，显示工具统计、阶段切换、知识模式 |
| `/memory-status` | 显示当前记忆状态摘要（session ID、turn 数、knowledge 数等） |

### 快捷查询

在会话中直接输入：

- `?memory` — 显示最近的 5 条知识模式
- `?memory <关键词>` — 按关键词过滤搜索（匹配 pattern 和 toolName）

## 配置

`extension-config.json`：

```json
{
  "injectMemoryOnStart": true,
  "autoSummarize": true,
  "maxKnowledgeEntries": 100,
  "thinkingPhaseMapping": {
    "deepseek": { "deepseek/deepseek-reasoner": "high" },
    "claude": { "anthropic/claude-sonnet-5": "high" },
    "planning": { "anthropic/claude-haiku-5": "low" }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `injectMemoryOnStart` | boolean | `true` | 是否在每轮开始时注入记忆上下文 |
| `autoSummarize` | boolean | `true` | agent 完成后是否自动生成总结 |
| `maxKnowledgeEntries` | number | `100` | 知识条目上限（超出移除最旧） |
| `thinkingPhaseMapping` | object | `{}` | 模型 → thinking level 映射，key 匹配 model id |

## 知识提取规则

`tool_result` 的错误模式匹配（`extractor.ts`）：

```
(?:command\s+)?not found
(cannot|unable).+?(?:find|access|resolve)
permission denied
(error|failed|failure):
ENOENT / EACCES / ETIMEDOUT
status:\s*(?:4\d\d|5\d\d)
(npm|pip|go|mvn|gradle)\s+(?:ERR!|error)
```

匹配成功的 output 会添加 `knowledge` 条目（category: "error"），最终在 `before_agent_start` 时注入 system prompt 供 LLM 参考。

## 存储

| 存储 | 路径 | 说明 |
|------|------|------|
| 状态文件 | `~/.pi/agent/extensions/pi-session-memory/memory-state.json` | 磁盘持久化，session 切换/关闭时写入 |
| 会话条目 | `pi.appendEntry("memory-summary", ...)` | 附加到会话文件，通过自定义 renderer 渲染 |

## 文件结构

```
~/.pi/agent/extensions/pi-session-memory/
├── index.ts               # 入口：注册命令 + 全部事件
├── state.ts               # 状态类型 + 管理工具
├── extractor.ts           # 知识提取 + 会话总结
├── extension-config.json  # 外部配置
└── memory-state.json      # 运行时生成的持久化状态
```

## 开发

扩展使用 Pi 的标准目录风格（`index.ts` + 子模块），通过 jiti 加载，TypeScript 无需编译。

新增事件时，使用 `safe()` 包装器自动处理错误隔离：

```typescript
pi.on("event_name", safe("event_name", async (event, ctx) => {
  // 逻辑
}))
```
