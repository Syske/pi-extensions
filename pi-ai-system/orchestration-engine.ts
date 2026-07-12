import * as fs from "fs";
import * as path from "path";
import { type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { WorkflowPhase, CommandContext, PhaseResult, WorkspaceConfig, SessionState } from "./types";
import { SessionStore } from "./session-store";
import { PromptResolver } from "./prompt-resolver";
import { SubagentRunner, TokenPattern } from "pi-subagent";

const PHASE_CHAIN: WorkflowPhase[] = [
  "bootstrap",
  "prepare",
  "spec",
  "dev-setup",
  "develop",
  "review",
  "verify",
];

const PHASE_PRECONDITIONS: Record<WorkflowPhase, WorkflowPhase[]> = {
  bootstrap: [],
  prepare: ["bootstrap"],
  spec: ["bootstrap", "prepare"],
  "dev-setup": ["bootstrap", "prepare", "spec"],
  develop: ["bootstrap", "prepare", "spec", "dev-setup"],
  review: ["bootstrap", "prepare", "spec", "dev-setup", "develop"],
  verify: ["bootstrap", "prepare", "spec", "dev-setup", "develop", "review"],
};

export class OrchestrationEngine {
  private sessionStore: SessionStore;
  private promptResolver: PromptResolver;
  private workflowRunner: SubagentRunner;
  private config: WorkspaceConfig;
  private ctx: ExtensionCommandContext | null = null;
  private modelSwitcher: ((phase: WorkflowPhase) => Promise<void>) | null = null;
  private emitEvent: ((event: string, data?: any) => void) | null = null;

  constructor(workspaceName: string, workspacesRoot?: string) {
    this.sessionStore = new SessionStore(workspaceName, workspacesRoot);
    this.promptResolver = new PromptResolver(this.sessionStore);
    this.workflowRunner = new SubagentRunner([
      new TokenPattern(/\[TODO_COMPLETE:\s*([^\]]+)\]/g, (id) => {
        this.emitEvent?.("todo:complete", { todoId: id });
      }),
    ]);
    this.config = this.sessionStore.loadOrCreateConfig();
  }

  setCtx(ctx: ExtensionCommandContext): void {
    this.ctx = ctx;
  }

  setModelSwitcher(fn: (phase: WorkflowPhase) => Promise<void>): void {
    this.modelSwitcher = fn;
  }

  setEventEmitter(emit: (event: string, data?: any) => void): void {
    this.emitEvent = emit;
  }

  async runPhase(phase: WorkflowPhase, context: CommandContext): Promise<PhaseResult> {
    if (!context.autoMode) {
      const preconditions = PHASE_PRECONDITIONS[phase];
      const session = this.sessionStore.loadSession();
      const missing: string[] = [];

      for (const pre of preconditions) {
        if (!session || !session.completedPhases.includes(pre)) {
          missing.push(pre);
        }
      }

      if (missing.length > 0) {
        return {
          phase,
          exitCode: -1,
          artifacts: [],
          error: `缺少前置阶段: ${missing.join(", ")}，请先执行 /as-${missing.join(", /as-")}`,
        };
      }
    }

    if (!context.autoMode && this.ctx) {
      const proceed = await this.ctx.ui.confirm(
        "▶️ 阶段确认",
        `即将进入 ${phase} 阶段，是否继续？`
      );
      if (!proceed) {
        return { phase, exitCode: 0, artifacts: [] };
      }
    }

    const initialTodos = this.getDefaultTodos(phase);
    if (initialTodos.length > 0) {
      this.emitEvent?.("todo:add", { category: phase, items: initialTodos });
    }

    const session = this.sessionStore.loadSession();
    if (session) {
      session.currentPhase = phase;
      this.sessionStore.saveSession(session);
    }

    await this.modelSwitcher?.(phase);

    const systemPrompt = this.promptResolver.resolve(phase, this.config);

    if (!this.ctx) {
      return { phase, exitCode: -1, artifacts: [], error: "Engine context not set — call setCtx() first" };
    }
    const subResult = await this.workflowRunner.spawn({ name: phase, systemPrompt }, this.ctx);
    const result: PhaseResult = { phase, exitCode: subResult.exitCode, artifacts: subResult.artifacts, error: subResult.error };

    if (result.exitCode === 0) {
      this.sessionStore.persist(phase, result.artifacts);

      const chainIndex = PHASE_CHAIN.indexOf(phase);
      if (chainIndex >= 0 && chainIndex < PHASE_CHAIN.length - 1) {
        this.emitEvent?.("todo:rollover", { from: phase, to: PHASE_CHAIN[chainIndex + 1] });
      }
    }

    return result;
  }

  async runChain(
    phases: WorkflowPhase[],
    context: CommandContext
  ): Promise<PhaseResult[]> {
    const results: PhaseResult[] = [];

    for (const phase of phases) {
      const result = await this.runPhase(phase, {
        ...context,
        workflow: phase,
      });

      results.push(result);

      if (result.exitCode !== 0) {
        if (context.autoMode) {
          break;
        }

        if (this.ctx) {
          const retry = await this.ctx.ui.confirm(
            "🔁 重试",
            `${phase} 阶段失败，是否重试？`
          );

          if (retry) {
            const retryResult = await this.runPhase(phase, {
              ...context,
              workflow: phase,
            });
            results[results.length - 1] = retryResult;
          }
        }

        if (results[results.length - 1].exitCode !== 0) {
          break;
        }
      }
    }

    return results;
  }

  getStatus(): { workspace: string; session: SessionState | null } {
    const session = this.sessionStore.loadSession();
    return {
      workspace: this.sessionStore.getWorkspacePath(),
      session,
    };
  }

  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  getConfig(): WorkspaceConfig {
    return this.config;
  }

  private getDefaultTodos(phase: WorkflowPhase): string[] {
    switch (phase) {
      case "bootstrap":
        return [
          "Initialize workspace directory structure",
          "Create workspace configuration",
          "Set up environment context",
        ];
      case "prepare":
        return [
          "Clarify requirements",
          "Research technical feasibility",
          "Identify risks and open questions",
          "Resolve all blocking unknowns",
        ];
      case "spec":
        return [
          "Write specification proposal",
          "Design architecture",
          "Write contracts",
          "Create task cards",
        ];
      case "dev-setup":
        return [
          "Resolve project configuration",
          "Bind services to local repositories",
          "Confirm working branches",
          "Verify git state",
        ];
      case "develop":
        return [
          "Analyze task card requirements",
          "Implement solution",
          "Write tests",
          "Verify implementation",
        ];
      case "review":
        return [
          "Review code quality",
          "Check architecture alignment",
          "Verify test coverage",
          "Check documentation",
        ];
      case "verify":
        return [
          "Run full test suite",
          "Verify contracts",
          "Check integration points",
          "Confirm specification compliance",
        ];
      default:
        return [];
    }
  }

  async bootstrapWorkspace(workspaceName: string): Promise<boolean> {
    const wsPath = this.sessionStore.getWorkspacePath();

    if (fs.existsSync(wsPath)) {
      const session = this.sessionStore.loadSession();
      if (session && session.completedPhases.includes("bootstrap")) {
        if (this.ctx) {
          this.ctx.ui.notify(`💡 工作空间 '${workspaceName}' 已初始化，无需重复执行`, "warning");
        }
        return false;
      }
      if (session && session.status === "interrupted") {
        if (this.ctx) {
          const resume = await this.ctx.ui.confirm(
            "🔄 恢复会话",
            `工作空间 ${workspaceName} 有未完成的会话，是否恢复？`
          );
          return resume;
        }
      }
      if (session && !session.completedPhases.includes("bootstrap")) {
        session.completedPhases.push("bootstrap" as WorkflowPhase);
        this.sessionStore.saveSession(session);
      }
      return true;
    }

    if (this.ctx) {
      const create = await this.ctx.ui.confirm(
        "📦 创建工作空间",
        `工作空间 ${workspaceName} 不存在，是否创建？`
      );
      if (!create) return false;
    }

    const dirs = [
      wsPath,
      this.sessionStore.resolvePath("specs"),
      this.sessionStore.resolvePath("contracts"),
      this.sessionStore.resolvePath("tasks"),
      this.sessionStore.resolvePath("tasks/cards"),
      this.sessionStore.resolvePath("contexts"),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const config = this.sessionStore.loadOrCreateConfig();
    this.sessionStore.saveConfig(config);

    this.sessionStore.saveSession({
      workspaceName,
      completedPhases: ["bootstrap"],
      status: "active",
      artifacts: {},
    });

    return true;
  }
}
