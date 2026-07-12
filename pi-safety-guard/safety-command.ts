import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { ScopeCache } from "./scope-cache"
import type { SafetyConfig } from "./types"

function parseArgs(args: string, expected: number): string[] {
  const parts = args.trim().split(/\s+/);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) {
    return [];
  }
  return parts.slice(0, expected);
}

export function registerSafetyCommand(
  pi: any,
  cache: ScopeCache,
  config: SafetyConfig,
): void {
  pi.registerCommand("safety", {
    description: "View and manage safety guard state",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = parseArgs(args, 2)
      const sub = parts[0]?.toLowerCase()

      if (sub === "status" || !sub) {
        const stats = cache.stats()
        const entries = cache.entries()
        let output = `🔒 pi-safety-guard 状态\n`
        output += `  缓存条目: ${stats.total} (已批准 ${stats.approved} / 待批准 ${stats.blocked})\n`
        output += `  高风险始终拦截: ${config.alwaysBlockHighRisk}\n`
        output += `  按文件缓存中风险: ${config.cacheMediumRiskByFile}\n\n`
        if (entries.length > 0) {
          output += `已批准的 scope:\n`
          for (const [key, entry] of entries) {
            if (!entry.approved) continue
            const label = entry.toolName ? `[${entry.toolName}]` : ""
            output += `  ✅ ${key} ${label}\n`
          }
        }
        ctx.ui.notify(output, "info")
        return
      }

      if (sub === "revoke") {
        const key = parts.slice(1).join(" ")
        if (!key) {
          ctx.ui.notify("用法: /safety revoke <文件路径或命令>", "error")
          return
        }
        if (cache.revoke(key)) {
          ctx.ui.notify(`已撤销批准: ${key}`, "info")
        } else {
          ctx.ui.notify(`未找到: ${key}`, "error")
        }
        return
      }

      if (sub === "reset") {
        cache.reset()
        ctx.ui.notify("已清空所有批准缓存，所有操作将重新要求批准", "info")
        return
      }

      ctx.ui.notify(
        "用法: /safety [status|revoke <key>|reset]",
        "error",
      )
    },
  })
}
