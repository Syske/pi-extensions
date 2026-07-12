import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { ModelSelector, estimateComplexity } from "./model-selector"
import type { TaskComplexity } from "./types"

interface SubagentResult {
  name: string
  exitCode: number
  artifacts: string[]
  error?: string
}

async function runSubagent(
  name: string,
  systemPrompt: string,
  ctx: ExtensionCommandContext,
): Promise<SubagentResult> {
  const artifacts: string[] = []
  const startMsg = `开始执行 **${name}** 阶段工作\n\n请严格遵循以下系统指令:\n\n${systemPrompt}`

  const { cancelled } = await ctx.newSession({
    withSession: async (subCtx) => {
      subCtx.sendUserMessage(startMsg)
      await subCtx.waitForIdle()

      const entries = subCtx.sessionManager.getEntries()
      for (const entry of entries) {
        if (entry.type !== "message") continue
        const text =
          typeof entry.message === "string"
            ? entry.message
            : JSON.stringify(entry.message)

        const artifactMatches = text.match(/\[ARTIFACT:\s*([^\]]+)\]/g)
        if (artifactMatches) {
          for (const match of artifactMatches) {
            const artifactPath = match
              .replace(/\[ARTIFACT:\s*|\]/g, "")
              .trim()
            artifacts.push(artifactPath)
          }
        }
      }
    },
  })

  return {
    name,
    exitCode: cancelled ? -1 : 0,
    artifacts,
  }
}

export function registerTaskRouter(
  pi: ExtensionAPI,
  selector: ModelSelector,
): void {
  pi.registerTool({
    name: "launch_subagent_with_model",
    label: "Launch Subagent with Model Selection",
    description: "Delegate a task to a subagent. Specify the complexity for optimal model selection, or let the system estimate it automatically.",
    promptSnippet: "Delegate tasks to subagents for parallel or isolated work",
    promptGuidelines: [
      "Use launch_subagent_with_model when a task is unrelated to the main goal and can be handled independently",
      "Specify complexity as 'small', 'medium', or 'large'. If unsure, skip it and the system will auto-detect",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Task description and instructions for the subagent" }),
      name: Type.Optional(Type.String({ description: "A short label for this subagent task (optional, auto-generated if omitted)" })),
      complexity: Type.Optional(Type.Union([
        Type.Literal("small"),
        Type.Literal("medium"),
        Type.Literal("large"),
      ], { description: "Task complexity for model selection: small=simple, medium=moderate, large=complex reasoning" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = params.task as string
      const name = (params.name as string | undefined) ?? `subtask-${Date.now()}`
      const complexity = (params.complexity as TaskComplexity | undefined) ?? estimateComplexity(task)
      const model = selector.pick(complexity)

      const previousModel = ctx.model?.id
      let modelChanged = false

      if (previousModel !== model) {
        try {
          pi.setModel(model)
          modelChanged = true
        } catch { }
      }

      const result = await runSubagent(name, task, ctx as ExtensionCommandContext)

      if (modelChanged && previousModel) {
        try {
          pi.setModel(previousModel)
        } catch { }
      }

      if (result.exitCode !== 0) {
        return {
          content: [{ type: "text", text: result.error ?? "Subagent failed with unknown error" }],
          isError: true,
          details: { subagentName: name, modelUsed: model, artifacts: result.artifacts },
        }
      }

      const artifactList = result.artifacts.length > 0
        ? `\n\n产出的文件:\n${result.artifacts.map((a) => `  - ${a}`).join("\n")}`
        : ""

      return {
        content: [{ type: "text", text: `Subagent **${name}** 完成 (模型: ${model})${artifactList}` }],
        details: { subagentName: name, modelUsed: model, exitCode: result.exitCode, artifacts: result.artifacts },
      }
    },
  })
}
