import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { ModelSelector } from "./model-selector"
import { registerTaskRouter } from "./task-router"
import { registerContextMonitor } from "./context-monitor"
import { ORCHESTRATOR_RULES } from "./system-prompt"
import { DEFAULT_CONFIG, type OrchestratorConfig } from "./types"

export default function install(pi: ExtensionAPI) {
  const config: OrchestratorConfig = { ...DEFAULT_CONFIG }

  const selector = new ModelSelector(config.modelMap)

  let promptInjected = false

  pi.on("before_agent_start", async (event) => {
    if (promptInjected) return
    promptInjected = true
    return {
      systemPrompt: event.systemPrompt + ORCHESTRATOR_RULES,
    }
  })

  pi.on("session_shutdown", async () => {
    promptInjected = false
  })

  pi.on("session_before_switch", async () => {
    promptInjected = false
  })

  pi.on("session_before_fork", async () => {
    promptInjected = false
  })

  registerTaskRouter(pi, selector)
  registerContextMonitor(pi, config)

  pi.registerCommand("ctx", {
    description: "查看上下文使用情况和 orchestrator 状态",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const usage = ctx.getContextUsage()
      if (!usage || usage.percent === null) {
        ctx.ui.notify("上下文使用率: 未知", "info")
        return
      }
      ctx.ui.notify(
        `上下文: ${usage.percent.toFixed(1)}% (${usage.tokens}/${usage.contextWindow})\n` +
        `阈值: ${config.contextThreshold}%\n` +
        `模型映射: small=${config.modelMap.small}, medium=${config.modelMap.medium}, large=${config.modelMap.large}`,
        "info",
      )
    },
  })
}
