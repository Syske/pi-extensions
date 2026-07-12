import type { ModelTierConfig, TaskComplexity } from "./types"

export function estimateComplexity(taskDescription: string): TaskComplexity {
  const text = taskDescription.toLowerCase()

  const largeSignals = [
    "架构", "设计", "调研", "分析", "方案",
    "architecture", "design", "analyze",
    "migrate", "refactor", "optimize",
    "architecture", "strategy",
  ]
  const mediumSignals = [
    "review", "代码审查", "测试", "重构",
    "test", "implement", "feature",
    "refactor",
  ]

  for (const signal of largeSignals) {
    if (text.includes(signal)) return "large"
  }
  for (const signal of mediumSignals) {
    if (text.includes(signal)) return "medium"
  }

  const wordCount = text.split(/\s+/).length
  if (wordCount > 100) return "large"
  if (wordCount > 30) return "medium"
  return "small"
}

export class ModelSelector {
  constructor(private modelMap: ModelTierConfig) {}

  pick(complexity: TaskComplexity): string {
    return this.modelMap[complexity]
  }

  availableTiers(): string[] {
    return ["small", "medium", "large"]
  }
}
