import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { isToolCallEventType, isBashToolResult } from "@earendil-works/pi-coding-agent"
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  createInitialState,
  updateToolStat,
  addKnowledge,
  trackPhase,
  buildMemoryPrompt,
  generateSessionSummary,
  DEFAULT_CONFIG,
  type MemoryState,
  type ExtensionConfig,
} from "./state"
import {
  extractPatternFromToolResult,
  getToolCallSummary,
  getPhaseSummary,
  getKnowledgeSummary,
} from "./extractor"

const EXT_NAME = "pi-session-memory"
const CONFIG_FILE = "extension-config.json"
const STATE_FILE = "memory-state.json"

let memoryState: MemoryState | undefined
let config: ExtensionConfig

function getExtDir(): string {
  return join(__dirname)
}

function loadConfig(): ExtensionConfig {
  try {
    const cfgPath = join(getExtDir(), CONFIG_FILE)
    if (existsSync(cfgPath)) {
      const raw = readFileSync(cfgPath, "utf-8")
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch { }
  return { ...DEFAULT_CONFIG }
}

function loadStateFromDisk(): MemoryState | undefined {
  try {
    const fp = join(getExtDir(), STATE_FILE)
    if (existsSync(fp)) {
      return JSON.parse(readFileSync(fp, "utf-8"))
    }
  } catch { }
  return undefined
}

function saveStateToDisk(state: MemoryState): void {
  try {
    writeFileSync(join(getExtDir(), STATE_FILE), JSON.stringify(state, null, 2), "utf-8")
  } catch { }
}

function safe<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    try {
      return fn(...args)
    } catch (err) {
      console.error(`[${EXT_NAME}] ${name}:`, err)
      return undefined as unknown as R
    }
  }
}

// ── Entry point ───────────────────────────────────────────

export default function install(pi: ExtensionAPI) {
  config = loadConfig()

  // ── Commands ──────────────────────────────────────────

  pi.registerCommand("memory-scan", {
    description: "Scan current session for skills, tools, and patterns used",
    handler: safe("memory-scan", async (_args: string, ctx: ExtensionCommandContext) => {
      if (!memoryState) { ctx.ui.notify("No memory state available", "warn"); return }

      const branch = ctx.sessionManager.getBranch()
      let toolCallsCount = 0, fileOps = 0, bashOps = 0

      for (const entry of branch) {
        if (entry.type === "message" && (entry as any).message?.role === "assistant") {
          const msg = (entry as any).message
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              toolCallsCount++
              const name = tc.function?.name ?? "unknown"
              if (name === "bash") bashOps++
              if (["read", "write", "edit", "glob", "grep"].includes(name)) fileOps++
            }
          }
        }
      }

      const lines = [
        "── Memory Classification Scan ──",
        `Session tools: ${toolCallsCount} total  (bash: ${bashOps}, file: ${fileOps})`,
        `Turns: ${memoryState.totalTurns}`,
      ]
      const ps = getPhaseSummary(memoryState)
      if (ps.length) lines.push(`Phases: ${ps.join(", ")}`)
      const ts = getToolCallSummary(memoryState)
      if (ts.length) {
        lines.push("Tool stats:")
        for (const t of ts) lines.push(`  ${t.toolName}: ${t.calls}c${t.errors > 0 ? `/${t.errors}e` : ""}`)
      }
      const ks = getKnowledgeSummary(memoryState)
      if (ks.length) { lines.push("Patterns:"); for (const k of ks) lines.push(`  ${k}`) }
      ctx.ui.notify(lines.join("\n"), "info")
    }),
  })

  pi.registerCommand("memory-status", {
    description: "Show current extracted knowledge and session state",
    handler: safe("memory-status", async (_args: string, ctx: ExtensionCommandContext) => {
      if (!memoryState) { ctx.ui.notify("No memory active. Start working to build state.", "info"); return }
      const lines = [
        `── Memory Status ──`,
        `Session: ${memoryState.sessionId.slice(0, 12)}...`,
        `Started: ${new Date(memoryState.startedAt).toLocaleTimeString()}`,
        `Turns: ${memoryState.totalTurns}`,
        `Tools tracked: ${Object.keys(memoryState.toolStats).length}`,
        `Knowledge entries: ${memoryState.knowledge.length}`,
        `Phases: ${memoryState.phases.length}`,
      ]
      if (memoryState.currentModel) lines.push(`Model: ${memoryState.currentModel}`)
      if (memoryState.currentThinkingLevel) lines.push(`Thinking: ${memoryState.currentThinkingLevel}`)
      ctx.ui.notify(lines.join("\n"), "info")
    }),
  })

  // ── Resources ─────────────────────────────────────────

  pi.on("resources_discover", safe("resources_discover", async (_event, _ctx) => {
    return {}
  }))

  // ── Session Events ────────────────────────────────────

  pi.on("session_start", safe("session_start", async (event, ctx) => {
    const reason = event.reason
    const sessionId = ctx.sessionManager.getSessionId() ?? `session_${Date.now()}`
    memoryState = createInitialState(sessionId)

    if (reason === "resume") {
      const prev = loadStateFromDisk()
      if (prev) memoryState = { ...prev, sessionId, startedAt: Date.now() }
    }

    if (reason === "fork" && event.previousSessionFile) {
      const prev = loadStateFromDisk()
      if (prev) {
        memoryState = { ...prev, sessionId: `${sessionId}_fork`, startedAt: Date.now() }
      }
    }
  }))

  pi.on("session_shutdown", safe("session_shutdown", async (_event, _ctx) => {
    if (memoryState) {
      const summary = generateSessionSummary(memoryState)
      if (summary) {
        pi.appendEntry("memory-summary", { summary, exportedAt: Date.now(), sessionId: memoryState.sessionId })
      }
      saveStateToDisk(memoryState)
    }
    memoryState = undefined
  }))

  pi.on("session_before_compact", safe("session_before_compact", async (event, _ctx) => {
    if (!memoryState) return
    return {
      compaction: {
        summary: buildMemoryPrompt(memoryState)
          ?? `Memory: ${memoryState.totalTurns}turns, ${Object.keys(memoryState.toolStats).length}tools`,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    }
  }))

  pi.on("session_compact", safe("session_compact", async (event, _ctx) => {
    if (!memoryState) return
    memoryState.knowledge = memoryState.knowledge.filter(k =>
      Date.now() - k.lastSeen < 3_600_000
    )
  }))

  pi.on("session_before_tree", safe("session_before_tree", async (event, _ctx) => {
    if (!memoryState) return
    return {
      summary: {
        summary: buildMemoryPrompt(memoryState) ?? `Memory preserved (${Date.now()})`,
        details: { totalTurns: memoryState.totalTurns, toolsUsed: Object.keys(memoryState.toolStats), knowledgeCount: memoryState.knowledge.length },
      },
    }
  }))

  pi.on("session_before_switch", safe("session_before_switch", async () => {
    if (memoryState) saveStateToDisk(memoryState)
  }))

  pi.on("session_before_fork", safe("session_before_fork", async () => {
    if (memoryState) saveStateToDisk(memoryState)
  }))

  pi.on("session_info_changed", safe("session_info_changed", async (event) => {
    if (!memoryState) return
    pi.events?.emit("pi-session-memory:state-changed", {
      name: event.name, phase: memoryState.currentPhase, tools: Object.keys(memoryState.toolStats).length,
    })
  }))

  // ── Agent Events ─────────────────────────────────────

  pi.on("before_agent_start", safe("before_agent_start", async (event) => {
    if (!memoryState || !config.injectMemoryOnStart) return
    const memoryContext = buildMemoryPrompt(memoryState)
    if (memoryContext) {
      return { systemPrompt: event.systemPrompt + "\n\n" + memoryContext }
    }
  }))

  pi.on("turn_start", safe("turn_start", async () => {
    if (!memoryState) return
    memoryState.totalTurns++
    if (memoryState.currentPhase) {
      const phase = memoryState.phases[memoryState.phases.length - 1]
      if (phase) phase.toolCount++
    }
  }))

  pi.on("turn_end", safe("turn_end", async (event) => {
    if (!memoryState || !event.toolResults) return
    for (const tr of event.toolResults) {
      updateToolStat(memoryState, tr.toolName, tr.isError ?? false)
    }
  }))

  pi.on("agent_settled", safe("agent_settled", async () => {
    if (!memoryState || !config.autoSummarize) return
    const summary = generateSessionSummary(memoryState)
    if (summary) pi.appendEntry("memory-summary", { summary, timestamp: Date.now() })
  }))

  // ── Input Events ──────────────────────────────────────

  pi.on("input", safe("input", async (event, ctx) => {
    if (event.text === "?memory" && memoryState) {
      const lines = [`Knowledge: ${memoryState.knowledge.length} entries`]
      const ks = getKnowledgeSummary(memoryState, 5)
      for (const k of ks) lines.push(`  ${k}`)
      ctx.ui.notify(lines.join("\n"), "info")
      return { action: "handled" as const }
    }
    if (event.text.startsWith("?memory ") && memoryState) {
      const q = event.text.slice(8).toLowerCase()
      const found = memoryState.knowledge.filter(k =>
        k.pattern.toLowerCase().includes(q) || k.toolName.toLowerCase().includes(q)
      )
      if (found.length) {
        ctx.ui.notify(found.map(k => `[${k.category}] ${k.toolName}: ${k.pattern} (${k.count}x)`).join("\n"), "info")
      } else {
        ctx.ui.notify("No matching memory patterns found", "info")
      }
      return { action: "handled" as const }
    }
  }))

  // ── Tool Events ───────────────────────────────────────

  pi.on("tool_call", safe("tool_call", async (event) => {
    if (!memoryState) return
    updateToolStat(memoryState, event.toolName, false)

    if (isToolCallEventType("write", event)) {
      addKnowledge(memoryState, "write", "file written", event.input.filePath ?? "unknown", "pattern")
    }
    if (isToolCallEventType("edit", event)) {
      addKnowledge(memoryState, "edit", "file edited", event.input.filePath ?? "unknown", "pattern")
    }
    if (isToolCallEventType("read", event)) {
      addKnowledge(memoryState, "read", "file read", event.input.filePath ?? "unknown", "pattern")
    }
    if (isToolCallEventType("glob", event)) {
      addKnowledge(memoryState, "glob", "file search", event.input.pattern ?? "unknown", "pattern")
    }
    if (isToolCallEventType("grep", event)) {
      addKnowledge(memoryState, "grep", "content search", event.input.pattern ?? "unknown", "pattern")
    }
    if (isToolCallEventType("bash", event) && event.input.command?.length > 200) {
      addKnowledge(memoryState, "bash", "long command", event.input.command.slice(0, 80), "pattern")
    }
  }))

  pi.on("tool_result", safe("tool_result", async (event) => {
    if (!memoryState) return
    const isError = event.isError ?? false
    updateToolStat(memoryState, event.toolName, isError)

    const contentText = Array.isArray(event.content)
      ? event.content.map(c => typeof c === "string" ? c : (c as any).text ?? "").join("\n")
      : typeof event.content === "string"
        ? event.content
        : ""

    const extracted = extractPatternFromToolResult(event.toolName, contentText, isError)
    if (extracted) {
      addKnowledge(memoryState, event.toolName, extracted.pattern, extracted.evidence, extracted.category)
    }

    if (isBashToolResult(event)) {
      const exitCode = event.details?.exitCode
      if (exitCode !== undefined && exitCode !== 0) {
        addKnowledge(memoryState, "bash", `exit code ${exitCode}`, `exit: ${exitCode}`, "error")
      }
    }
  }))

  // ── Model Events ─────────────────────────────────────

  pi.on("model_select", safe("model_select", async (event, ctx) => {
    if (!memoryState) return
    memoryState.currentModel = `${event.model.provider}/${event.model.id}`
    const newPhase = trackPhase(memoryState, { provider: event.model.provider, id: event.model.id })
    if (newPhase) ctx.ui.notify(`Memory: phase ${newPhase}`, "info")

    if (config.thinkingPhaseMapping && memoryState.currentPhase) {
      const phaseKey = Object.keys(config.thinkingPhaseMapping).find(k =>
        memoryState.currentPhase?.includes(k)
      )
      if (phaseKey) {
        const level = config.thinkingPhaseMapping[phaseKey][memoryState.currentPhase!]
        if (level) pi.setThinkingLevel(level as any)
      }
    }
  }))

  pi.on("thinking_level_select", safe("thinking_level_select", async (event, ctx) => {
    if (!memoryState) return
    memoryState.currentThinkingLevel = event.level
    ctx.ui.setStatus("memory-thinking", `thinking: ${event.level}`)
  }))

  // ── Entry Renderer ────────────────────────────────────

  pi.registerEntryRenderer("memory-summary", (_data, _ctx) => {
    const summary = (_data as any)?.summary
    const lines = typeof summary === "string" ? summary.split("\n") : [JSON.stringify(_data)]
    return { summary: lines[0] ?? "memory snapshot", details: lines.slice(1).join("\n") }
  })
}
