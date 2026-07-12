import { type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SubagentOptions, SubagentResult, TokenPattern } from "./types";

export class SubagentRunner {
  private tokenPatterns: TokenPattern[] = [];

  constructor(patterns?: TokenPattern[]) {
    if (patterns) {
      this.tokenPatterns = [...patterns];
    }
  }

  addPattern(pattern: TokenPattern): void {
    this.tokenPatterns.push(pattern);
  }

  async spawn(
    options: SubagentOptions,
    ctx: ExtensionCommandContext,
    setModel?: (id: string) => Promise<void>,
  ): Promise<SubagentResult> {
    const timeoutMs = options.timeoutMs ?? 300000;
    const previousModel = ctx.model?.id;
    let modelChanged = false;

    if (options.model && setModel && previousModel !== options.model) {
      await setModel(options.model);
      modelChanged = true;
    }

    const restoreModel = async () => {
      if (modelChanged && previousModel) {
        await setModel!(previousModel);
      }
    };

    return new Promise((resolve) => {
      let finished = false;

      const timer = setTimeout(async () => {
        if (finished) return;
        finished = true;
        await restoreModel();
        resolve({
          name: options.name,
          exitCode: -1,
          artifacts: [],
          error: `Timeout after ${timeoutMs}ms`,
          cancelled: false,
        });
      }, timeoutMs);

      this.runWithSession(options, ctx)
        .then(async (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          await restoreModel();
          resolve(result);
        })
        .catch(async (err) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          await restoreModel();
          resolve({
            name: options.name,
            exitCode: -1,
            artifacts: [],
            error: err instanceof Error ? err.message : String(err),
            cancelled: false,
          });
        });
    });
  }

  private async runWithSession(
    options: SubagentOptions,
    ctx: ExtensionCommandContext,
  ): Promise<SubagentResult> {
    const artifacts: string[] = [];
    const startMsg = `开始执行 **${options.name}** 阶段工作\n\n请严格遵循以下系统指令:\n\n${options.systemPrompt}`;

    const { cancelled } = await ctx.newSession({
      withSession: async (subCtx) => {
        subCtx.sendUserMessage(startMsg);
        await subCtx.waitForIdle();

        const entries = subCtx.sessionManager.getEntries();
        for (const entry of entries) {
          if (entry.type !== "message") continue;

          const text =
            typeof entry.message === "string"
              ? entry.message
              : JSON.stringify(entry.message);

          const artifactMatches = text.match(/\[ARTIFACT:\s*([^\]]+)\]/g);
          if (artifactMatches) {
            for (const match of artifactMatches) {
              const artifactPath = match
                .replace(/\[ARTIFACT:\s*|\]/g, "")
                .trim();
              artifacts.push(artifactPath);
            }
          }

          for (const tp of this.tokenPatterns) {
            const matches = text.match(tp.pattern);
            if (matches) {
              for (const match of matches) {
                const value = this.extractValue(match);
                tp.handler(value);
              }
            }
          }
        }
      },
    });

    return {
      name: options.name,
      exitCode: cancelled ? -1 : 0,
      artifacts,
      cancelled,
    };
  }

  private extractValue(match: string): string {
    const colonIdx = match.indexOf(":");
    if (colonIdx === -1) return match;
    return match.slice(colonIdx + 1).replace(/[[\]]/g, "").trim();
  }
}
