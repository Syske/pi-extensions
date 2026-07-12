export const ORCHESTRATOR_RULES = `

## pi-context-orchestrator — 上下文管理规则

### 1. Subagent 分派

如果当前任务与主目标无关（比如查资料、小工具脚本、独立调研），应当启动 subagent 来处理，以避免主 agent 的上下文被无关内容污染。

使用 \`launch_subagent_with_model\` 工具将任务委派给 subagent，subagent 会独立完成工作并将结果返回。

### 2. 模型选择

对于不同复杂度的任务，选择适当的模型:

- **small** — 简单任务(单文件编辑、搜索、文档生成): 使用 \`deepseek-v4-flash\`
- **medium** — 中等任务(多文件重构、review、测试): 使用 \`deepseek-v4-flash\`
- **large** — 复杂任务(架构设计、复杂调试、跨模块分析): 使用 \`deepseek-v4-pro\`

启动 subagent 时，在 \`launch_subagent_with_model\` 的参数中指定 \`complexity\`，系统会自动选择对应模型。

### 3. 上下文压力管理

当上下文使用率达到 75% 时，系统会自动:
1. 保存当前待办事项
2. 生成会话摘要
3. 触发上下文压缩

请保持任务适度的原子性，以便在压缩边界能干净地切分。
`

export function getOrchestratorPrompt(): { systemPrompt: string } {
  return { systemPrompt: ORCHESTRATOR_RULES }
}
