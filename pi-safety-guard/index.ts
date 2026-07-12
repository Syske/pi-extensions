import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { ScopeCache } from "./scope-cache"
import { ToolGate } from "./tool-gate"
import { registerSafetyCommand } from "./safety-command"
import { SAFETY_RULES_PROMPT } from "./system-prompt"
import { DEFAULT_SAFETY_CONFIG, type SafetyConfig } from "./types"

const APPROVAL_PATTERNS = [
  /^(yes|y|ok|okay|go ahead|proceed|approved|approve)$/i,
  /^(批准|可以|好的|继续|执行|同意|开始吧)$/,
]

const REJECTION_PATTERNS = [
  /^(no|n|stop|cancel|deny|reject)$/i,
  /^(不要|不行|拒绝|不同意|取消|停下)$/,
]

function isApproval(text: string): boolean {
  return APPROVAL_PATTERNS.some((p) => p.test(text.trim()))
}

function isRejection(text: string): boolean {
  return REJECTION_PATTERNS.some((p) => p.test(text.trim()))
}

export default function install(pi: ExtensionAPI) {
  const config: SafetyConfig = { ...DEFAULT_SAFETY_CONFIG }
  const cache = new ScopeCache()
  const gate = new ToolGate()

  let promptInjected = false
  const pendingApprovals: string[] = []

  pi.on("before_agent_start", async (event) => {
    if (promptInjected) return
    promptInjected = true
    return {
      systemPrompt: event.systemPrompt + SAFETY_RULES_PROMPT,
    }
  })

  pi.on("session_shutdown", async () => {
    promptInjected = false
    cache.reset()
    pendingApprovals.length = 0
  })

  pi.on("session_before_switch", async () => {
    cache.reset()
    pendingApprovals.length = 0
  })

  pi.on("session_before_fork", async () => {
    cache.reset()
    pendingApprovals.length = 0
  })

  pi.on("tool_call", async (event, ctx) => {
    const result = gate.evaluate(event.toolName, event.input)

    if (result.action === "allow") return

    if (result.cacheKey) {
      const entry = cache.get(result.cacheKey)
      if (entry?.approved) return

      cache.set(result.cacheKey, {
        risk: result.risk ?? "medium",
        approved: false,
        toolName: event.toolName,
      })
      pendingApprovals.push(result.cacheKey)
    }

    return { block: true, reason: result.reason ?? "操作被安全拦截" }
  })

  pi.on("input", async (event, ctx) => {
    if (event.text.startsWith("/safety")) {
      return { action: "continue" as const }
    }

    if (isApproval(event.text) && pendingApprovals.length > 0) {
      for (const key of pendingApprovals) {
        cache.approve(key)
      }
      pendingApprovals.length = 0
    } else if (isRejection(event.text)) {
      pendingApprovals.length = 0
    }

    return { action: "continue" as const }
  })

  registerSafetyCommand(pi, cache, config)
}
