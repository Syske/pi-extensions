import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import type { OrchestratorConfig } from "./types"

function emitSaveTodos(pi: ExtensionAPI): void {
  try {
    (pi as any).events?.emit?.("todo:save", {})
  } catch {
    // pi-todo might not be installed; ignore
  }
}

function generateSummary(
  contextBefore: number,
  threshold: number,
): string {
  return `[上下文管理] 上下文使用率达到 ${contextBefore.toFixed(0)}% (阈值 ${threshold}%)，已自动保存待办并触发压缩。`
}

export function registerContextMonitor(
  pi: ExtensionAPI,
  config: OrchestratorConfig,
): void {
  let compressedThisSession = false

  pi.on("session_shutdown", async () => {
    compressedThisSession = false
  })

  pi.on("session_before_switch", async () => {
    compressedThisSession = false
  })

  pi.on("session_before_fork", async () => {
    compressedThisSession = false
  })

  pi.on("turn_end", async (event, ctx) => {
    if (compressedThisSession) return

    const usage = ctx.getContextUsage()
    if (!usage || usage.percent === null) return

    if (usage.percent >= config.contextThreshold) {
      compressedThisSession = true

      emitSaveTodos(pi)

      const summary = generateSummary(usage.percent, config.contextThreshold)
      ctx.ui.notify(summary, "info")
    }
  })
}
