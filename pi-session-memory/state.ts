export interface ModelSnapshot {
  provider: string
  id: string
}

export interface ToolStat {
  calls: number
  errors: number
  lastCall: number
  lastError?: string
  patterns: string[]
}

export interface PhaseRecord {
  phase: string
  model: string
  thinkingLevel: string
  toolCount: number
  startedAt: number
}

export interface KnowledgeEntry {
  pattern: string
  toolName: string
  evidence: string[]
  count: number
  firstSeen: number
  lastSeen: number
  category: "error" | "success" | "pattern"
}

export interface MemoryState {
  sessionId: string
  startedAt: number
  totalTurns: number
  toolStats: Record<string, ToolStat>
  phases: PhaseRecord[]
  knowledge: KnowledgeEntry[]
  currentPhase?: string
  currentModel?: string
  currentThinkingLevel?: string
  lastErrorSummary?: string
}

export interface ExtensionConfig {
  memoryPath?: string
  injectMemoryOnStart: boolean
  autoSummarize: boolean
  maxKnowledgeEntries: number
  modelPhaseMapping?: Record<string, string>
  thinkingPhaseMapping?: Record<string, Record<string, string>>
}

export const DEFAULT_CONFIG: ExtensionConfig = {
  injectMemoryOnStart: true,
  autoSummarize: true,
  maxKnowledgeEntries: 100,
}

export function createInitialState(sessionId: string): MemoryState {
  return {
    sessionId,
    startedAt: Date.now(),
    totalTurns: 0,
    toolStats: {},
    phases: [],
    knowledge: [],
  }
}

export function updateToolStat(state: MemoryState, toolName: string, isError: boolean, pattern?: string): void {
  let stat = state.toolStats[toolName]
  if (!stat) {
    stat = { calls: 0, errors: 0, lastCall: Date.now(), patterns: [] }
    state.toolStats[toolName] = stat
  }
  stat.calls++
  stat.lastCall = Date.now()
  if (isError) {
    stat.errors++
    if (pattern) stat.patterns.push(pattern)
  }
}

export function addKnowledge(state: MemoryState, toolName: string, pattern: string, evidence: string, category: KnowledgeEntry["category"]): void {
  let existing = state.knowledge.find(k => k.toolName === toolName && k.pattern === pattern)
  if (existing) {
    existing.count++
    existing.lastSeen = Date.now()
    if (!existing.evidence.includes(evidence)) {
      existing.evidence.push(evidence)
    }
    return
  }
  if (state.knowledge.length >= DEFAULT_CONFIG.maxKnowledgeEntries) {
    const oldest = state.knowledge.reduce((a, b) => a.lastSeen < b.lastSeen ? a : b)
    const idx = state.knowledge.indexOf(oldest)
    state.knowledge.splice(idx, 1)
  }
  state.knowledge.push({
    pattern,
    toolName,
    evidence: [evidence],
    count: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    category,
  })
}

export function trackPhase(state: MemoryState, model: ModelSnapshot): string | undefined {
  const phase = `${model.provider}/${model.id}`
  if (state.currentPhase !== phase) {
    state.phases.push({
      phase,
      model: `${model.provider}/${model.id}`,
      thinkingLevel: state.currentThinkingLevel ?? "medium",
      toolCount: 0,
      startedAt: Date.now(),
    })
    state.currentPhase = phase
    state.currentModel = `${model.provider}/${model.id}`
    return phase
  }
  return undefined
}

export function buildMemoryPrompt(state: MemoryState): string | undefined {
  const errorPatterns = state.knowledge.filter(k => k.category === "error").slice(0, 5)
  const successPatterns = state.knowledge.filter(k => k.category === "success").slice(0, 5)

  const parts: string[] = []
  if (errorPatterns.length > 0) {
    parts.push("<known_issues>")
    for (const k of errorPatterns) {
      parts.push(`- ${k.toolName}: ${k.pattern} (observed ${k.count}x)`)
    }
    parts.push("</known_issues>")
  }
  if (successPatterns.length > 0) {
    parts.push("<known_patterns>")
    for (const k of successPatterns) {
      parts.push(`- ${k.toolName}: ${k.pattern}`)
    }
    parts.push("</known_patterns>")
  }
  if (parts.length === 0) return undefined

  parts.unshift("<memory_classification context=\"session\">")
  parts.push("</memory_classification>")
  return parts.join("\n")
}
