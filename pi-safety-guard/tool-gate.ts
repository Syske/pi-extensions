import type { RiskLevel } from "./types"
import { classifyBashRisk, getBashCacheKey } from "./bash-analyzer"

export class ToolGate {
  extractFilePath(input: Record<string, unknown>): string | undefined {
    return (input.filePath as string | undefined)
      ?? (input.path as string | undefined)
      ?? (input.file_path as string | undefined)
      ?? undefined
  }

  private fileRisk(filePath: string): RiskLevel {
    const sensitiveFiles = [
      /\.gitignore$/i,
      /\.env$/i,
      /\.env\..+$/i,
      /package\.json$/i,
      /\.npmrc$/i,
      /\.gitconfig$/i,
      /^\.git\//,
      /\\\.git\\/,
    ]
    for (const p of sensitiveFiles) {
      if (p.test(filePath)) return "high"
    }
    return "medium"
  }

  evaluate(
    toolName: string,
    input: Record<string, unknown>,
  ): { action: "allow" | "block"; reason?: string; risk?: RiskLevel; cacheKey?: string } {
    switch (toolName) {
      case "read":
      case "list_files":
      case "glob":
      case "grep":
      case "search":
        return { action: "allow", risk: "low" }

      case "write":
      case "create_file": {
        const fpath = this.extractFilePath(input)
        if (!fpath) return { action: "allow", risk: "medium" }
        const risk = this.fileRisk(fpath)
        const key = `file:${fpath}`
        if (risk === "high") {
          return {
            action: "block",
            risk: "high",
            cacheKey: key,
            reason: `[🔴 高风险] 覆写敏感文件 ${fpath}。请先输出完整变更分析（含影响评估和回滚方案），然后等待用户批准。`,
          }
        }
        return {
          action: "block",
          risk: "medium",
          cacheKey: key,
          reason: `[🟡 需要批准] 首次写文件 ${fpath}。请先输出变更计划（目标文件、变更内容、变更原因），然后询问用户是否批准。`,
        }
      }

      case "edit": {
        const fpath = this.extractFilePath(input)
        if (!fpath) return { action: "allow", risk: "medium" }
        const risk = this.fileRisk(fpath)
        const key = `file:${fpath}`
        if (risk === "high") {
          return {
            action: "block",
            risk: "high",
            cacheKey: key,
            reason: `[🔴 高风险] 编辑敏感文件 ${fpath}。请先输出完整变更分析，然后等待用户批准。`,
          }
        }
        return {
          action: "block",
          risk: "medium",
          cacheKey: key,
          reason: `[🟡 需要批准] 首次编辑 ${fpath}。请先输出变更计划（目标文件、变更内容、变更原因），然后询问用户是否批准。`,
        }
      }

      case "delete":
      case "remove_file": {
        const fpath = this.extractFilePath(input)
        const key = fpath ? `delete:${fpath}` : `delete:${toolName}`
        return {
          action: "block",
          risk: "high",
          cacheKey: key,
          reason: fpath
            ? `[🔴 高风险] 删除文件 ${fpath}。请先输出完整变更分析（含影响评估和回滚方案），然后等待用户批准。`
            : `[🔴 高风险] 删除操作。请先输出完整变更分析，然后等待用户批准。`,
        }
      }

      case "bash":
      case "command": {
        const cmd = (input.command as string) ?? (input.cmd as string) ?? ""
        if (!cmd) return { action: "allow", risk: "low" }
        const risk = classifyBashRisk(cmd)
        if (risk === "low") return { action: "allow", risk: "low" }
        if (risk === "high") {
          const key = `bash-high:${cmd.slice(0, 120)}`
          return {
            action: "block",
            risk: "high",
            cacheKey: key,
            reason: `[🔴 高风险] bash 命令可能造成破坏：\`${cmd}\`。请先输出完整变更分析（含影响评估和回滚方案），然后等待用户批准。`,
          }
        }
        const cacheKey = getBashCacheKey(cmd)
        if (cacheKey) {
          return {
            action: "block",
            risk: "medium",
            cacheKey,
            reason: `[🟡 需要批准] bash 命令：\`${cmd}\`。请先说明要做什么以及为什么，然后询问用户是否批准。`,
          }
        }
        return { action: "block", risk: "medium" }
      }

      case "launch_subagent":
      case "start_subagent": {
        return {
          action: "block",
          risk: "medium",
          cacheKey: `tool:${toolName}`,
          reason: `[🟡 需要批准] 启动 subagent。请先说明 subagent 的任务目标和预期产出，然后询问用户是否批准。`,
        }
      }

      default:
        return { action: "allow", risk: "low" }
    }
  }
}
