import type { RiskLevel } from "./types"

const HIGH_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\brm\s+-(r|recursive)\s+/i,
  /\brd\s+\/s\b/i,
  /\brd\s+\/q\b/i,
  /\bdel\s+\/f\b/i,
  /\bdel\s+\/s\b/i,
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+push\s+-f\b/i,
]

const MEDIUM_PATTERNS: RegExp[] = [
  /\bgit\s+commit\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+checkout\b/i,
  /\bmv\s+/i,
  /\bcp\s+/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bnpm\s+install\b/i,
  /\bnpm\s+update\b/i,
  /\bnpm\s+uninstall\b/i,
  /\byarn\s+add\b/i,
  /\byarn\s+remove\b/i,
  /\bpip\s+install\b/i,
  /\bpip\s+uninstall\b/i,
  /\bcargo\s+install\b/i,
  /\bcargo\s+update\b/i,
  /\bdeno\s+install\b/i,
  /\bnuget\s+install\b/i,
  /\bgo\s+install\b/i,
  /\bdocker\s+rm\b/i,
  /\bdocker\s+rmi\b/i,
  /\bdocker\s+build\b/i,
  /\bdocker\s+compose\s+up\b/i,
  /\bdocker\s+compose\s+down\b/i,
  /\bSet-Content\b/i,
  /\bCopy-Item\b/i,
  /\bMove-Item\b/i,
  /\bRemove-Item\b/i,
  /\bNew-Item\b/i,
  /\bAdd-Content\b/i,
  /\bcurl\s+-X\s+DELETE\b/i,
  /\bcurl\s+-X\s+PUT\b/i,
  /\bcurl\s+-X\s+PATCH\b/i,
  /\binvoke-webrequest\b.*-method\s+(delete|put|patch)\b/i,
]

const LOW_PATTERNS: RegExp[] = [
  /\bls\b/i,
  /\bcat\b/i,
  /\bgrep\b/i,
  /\bfindstr\b/i,
  /\bfind\b/i,
  /\bhead\b/i,
  /\btail\b/i,
  /\becho\b/i,
  /\bpwd\b/i,
  /\bwhich\b/i,
  /\btype\b/i,
  /\bdir\b/i,
  /\bGet-ChildItem\b/i,
  /\bGet-Content\b/i,
  /\bSelect-String\b/i,
  /\bgit\s+status\b/i,
  /\bgit\s+diff\b/i,
  /\bgit\s+log\b/i,
  /\bgit\s+show\b/i,
  /\bgit\s+branch\b/i,
  /\bgit\s+remote\b/i,
  /\bgit\s+config\b/i,
  /\bnpm\s+ls\b/i,
  /\bnpm\s+list\b/i,
  /\bnpm\s+outdated\b/i,
  /\bdocker\s+ps\b/i,
  /\bdocker\s+images\b/i,
  /\bdocker\s+logs\b/i,
  /\bdocker\s+inspect\b/i,
  /\bTest-Path\b/i,
  /\bGet-Item\b/i,
  /\bGet-Location\b/i,
  /\bGet-Command\b/i,
  /\bhelp\b/i,
  /\bman\b/i,
]

export function classifyBashRisk(command: string): RiskLevel {
  for (const pattern of HIGH_PATTERNS) {
    if (pattern.test(command)) return "high"
  }
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.test(command)) return "medium"
  }
  for (const pattern of LOW_PATTERNS) {
    if (pattern.test(command)) return "low"
  }
  return "medium"
}

export function getBashCacheKey(command: string): string | null {
  const risk = classifyBashRisk(command)
  if (risk === "high") return null
  if (risk === "low") return null

  const firstWord = command.trim().split(/\s+/).slice(0, 2).join(" ")
  return `bash:${firstWord.toLowerCase()}`
}
