export type RiskLevel = "low" | "medium" | "high"

export interface CacheEntry {
  risk: RiskLevel
  approved: boolean
  approvedAt?: number
  toolName?: string
}

export interface SafetyConfig {
  alwaysBlockHighRisk: boolean
  cacheMediumRiskByFile: boolean
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  alwaysBlockHighRisk: true,
  cacheMediumRiskByFile: true,
}
