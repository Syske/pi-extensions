import type { MemoryState, KnowledgeEntry } from "./state"

const ERROR_PATTERNS = [
  /(?:command\s+)?not found/i,
  /(?:cannot|unable).+?(?:find|access|resolve)/i,
  /permission denied/i,
  /(?:error|failed|failure):/i,
  /ENOENT/i,
  /EACCES/i,
  /ETIMEDOUT/i,
  /status:\s*(?:4\d\d|5\d\d)/i,
  /(?:npm|pip|go|mvn|gradle)\s+(?:ERR!|error)/i,
]

const SUCCESS_SIGNALS = [
  /^(?:done|ok|success|completed)/mi,
]

export function extractPatternFromToolResult(toolName: string, content: string, isError: boolean): { pattern: string; category: KnowledgeEntry["category"]; evidence: string } | undefined {
  const evidence = truncate(content, 120)

  if (isError) {
    for (const re of ERROR_PATTERNS) {
      const match = content.match(re)
      if (match) {
        return { pattern: `error: ${match[0]}`, category: "error", evidence }
      }
    }
    return { pattern: "unrecognized error", category: "error", evidence }
  }

  if (toolName === "bash") {
    for (const re of SUCCESS_SIGNALS) {
      if (re.test(content)) {
        return { pattern: "command completed successfully", category: "success", evidence }
      }
    }
  }

  return undefined
}

export function getToolCallSummary(state: MemoryState): { toolName: string; calls: number; errors: number }[] {
  return Object.entries(state.toolStats)
    .map(([toolName, stat]) => ({ toolName, calls: stat.calls, errors: stat.errors }))
    .sort((a, b) => b.calls - a.calls)
}

export function getPhaseSummary(state: MemoryState): string[] {
  return state.phases.map(p =>
    `${p.phase} (${p.toolCount} tools, thinking: ${p.thinkingLevel})`
  )
}

export function getKnowledgeSummary(state: MemoryState, maxItems = 10): string[] {
  const sorted = [...state.knowledge].sort((a, b) => b.count - a.count).slice(0, maxItems)
  return sorted.map(k =>
    `[${k.category}] ${k.toolName}: ${k.pattern} (${k.count}x)`
  )
}

export function generateSessionSummary(state: MemoryState): string | undefined {
  if (state.totalTurns === 0) return undefined

  const lines: string[] = []
  lines.push(`Session: ${state.totalTurns} turns, ${Object.keys(state.toolStats).length} tools used`)

  const toolSummary = getToolCallSummary(state)
  if (toolSummary.length > 0) {
    const top = toolSummary.slice(0, 5).map(t => `${t.toolName}(${t.calls}c${t.errors > 0 ? `/${t.errors}e` : ""})`).join(", ")
    lines.push(`Tools: ${top}`)
  }

  const phaseSummary = getPhaseSummary(state)
  if (phaseSummary.length > 0) {
    lines.push(`Phases: ${phaseSummary.join(" → ")}`)
  }

  const knowledge = getKnowledgeSummary(state, 5)
  if (knowledge.length > 0) {
    lines.push("Knowledge:")
    for (const k of knowledge) lines.push(`  ${k}`)
  }

  return lines.join("\n")
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + "..."
}
