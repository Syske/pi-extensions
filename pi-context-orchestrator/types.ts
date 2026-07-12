export interface ModelTierConfig {
  small: string
  medium: string
  large: string
}

export const DEFAULT_MODEL_MAP: ModelTierConfig = {
  small: "deepseek-v4-flash",
  medium: "deepseek-v4-flash",
  large: "deepseek-v4-pro",
}

export interface OrchestratorConfig {
  contextThreshold: number
  modelMap: ModelTierConfig
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  contextThreshold: 75,
  modelMap: { ...DEFAULT_MODEL_MAP },
}

export type TaskComplexity = "small" | "medium" | "large"
