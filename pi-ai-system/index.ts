import * as fs from "fs";
import * as path from "path";
import { type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type ModelRegistry, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
import { OrchestrationEngine } from "./orchestration-engine";
import { WorkflowPhase, CommandContext } from "./types";
import { WorkspaceGuard } from "pi-workspace-guard";
import { getPhasesStatus, getWidgetLines } from "./status-footer";

export default function (pi: ExtensionAPI) {
  let engine: OrchestrationEngine | null = null;
  let activeWorkspace: string | null = null;
  const guard = new WorkspaceGuard({ stateFileName: "as-state.json" });
  let requestFooterRender: (() => void) | null = null;

  // === External config ===

  interface ExtensionConfig {
    phaseModels: Partial<Record<WorkflowPhase, { provider: string; modelId: string }>>;
    phaseThinkingLevels: Partial<Record<WorkflowPhase, ThinkingLevel>>;
  }

  let phaseModelMap: ExtensionConfig["phaseModels"] = {};
  let phaseThinkingMap: ExtensionConfig["phaseThinkingLevels"] = {};

  function loadExtensionConfig(): void {
    const configPath = path.join(__dirname, "extension-config.json");
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        const config: ExtensionConfig = JSON.parse(raw);
        phaseModelMap = config.phaseModels || {};
        phaseThinkingMap = config.phaseThinkingLevels || {};
      }
    } catch { }
  }

  loadExtensionConfig();

  async function switchPhaseModel(phase: WorkflowPhase, registry: ModelRegistry): Promise<void> {
    const target = phaseModelMap[phase];
    if (!target) return;
    try {
      const model = registry.find(target.provider, target.modelId);
      if (model) {
        await pi.setModel(model);
      }
    } catch { }
  }

  async function switchPhaseThinking(phase: WorkflowPhase): Promise<void> {
    const target = phaseThinkingMap[phase];
    if (!target) return;
    try {
      pi.setThinkingLevel(target);
    } catch { }
  }

  function restoreSession(ctx: ExtensionContext): void {
    safe("restoreSession", () => {
      const state = guard.loadState();
      if (!state) return;

      const workspacesDir = path.join(state.workspacePath, "workspaces");
      if (!fs.existsSync(workspacesDir)) return;

      for (const entry of fs.readdirSync(workspacesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const sessionFile = path.join(workspacesDir, entry.name, "session.json");
          if (fs.existsSync(sessionFile)) {
            activeWorkspace = entry.name;
            engine = new OrchestrationEngine(entry.name, workspacesDir);
            engine.setCtx(ctx as unknown as ExtensionCommandContext);
            engine.setModelSwitcher(async (p) => { await switchPhaseModel(p, ctx.modelRegistry); switchPhaseThinking(p); });
            engine.setEventEmitter((event, data) => pi.events?.emit(event, data));
            break;
          }
        }
      }
    });
  }

  pi.registerFlag("auto", {
    type: "boolean",
    description: "Auto-approve all phase transitions",
  });

  function parseArgs(args: string, expected: number): string[] {
    const parts = args.trim().split(/\s+/);
    if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) {
      return [];
    }
    return parts.slice(0, expected);
  }

  function getOrCreateEngine(workspaceName: string, cwd?: string): OrchestrationEngine {
    if (!engine) {
      engine = new OrchestrationEngine(workspaceName, cwd ? path.join(cwd, "workspaces") : undefined);
    }
    return engine;
  }

  function updateUI(ctx: ExtensionContext): void {
    safe("updateUI", () => {
      const wsPath = guard.getWorkspacePath();

      if (wsPath && activeWorkspace) {
        ctx.ui.setStatus("as-workspace", `📂 ${path.basename(wsPath)}  📦 ${activeWorkspace}`);
      } else if (wsPath) {
        ctx.ui.setStatus("as-workspace", `📂 ${path.basename(wsPath)}`);
      } else {
        ctx.ui.setStatus("as-workspace", undefined);
      }

      const phases = getPhasesStatus(() => engine);
      ctx.ui.setStatus("as-phases", phases);

      const widgetLines = getWidgetLines(() => engine);
      if (widgetLines && widgetLines.length > 0) {
        ctx.ui.setWidget("as-status", widgetLines, { placement: "belowEditor" });
      } else {
        ctx.ui.setWidget("as-status", undefined);
      }
    });
  }

  function getWorkspaceCompletions(prefix: string): AutocompleteItem[] | null {
    const wp = guard.getWorkspacePath();
    if (!wp) return null;
    const wsDir = path.join(wp, "workspaces");
    if (!fs.existsSync(wsDir)) return null;
    const names = fs.readdirSync(wsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ value: d.name, label: d.name }));
    const filtered = names.filter(n => n.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  }

  function showStatus(engine: OrchestrationEngine, ctx: ExtensionContext | ExtensionCommandContext): void {
    const session = engine.getSessionStore().loadSession();
    if (!session) {
      ctx.ui.notify("💡 工作空间未初始化", "warning");
      return;
    }
    ctx.ui.notify(
      `📦 ${session.workspaceName}\n⏳ ${session.currentPhase || "未开始"}\n✅ 已完成: ${session.completedPhases.join(", ") || "无"}`,
      "info"
    );
  }

  async function ensureInWorkspace(ctx: ExtensionCommandContext): Promise<boolean> {
    if (!guard.isInitialized()) {
      ctx.ui.notify("❌ ai-workspace 未初始化，请先执行 /as-init", "error");
      return false;
    }
    if (!guard.isInsideWorkspace(process.cwd())) {
      const wsPath = guard.getWorkspacePath()!;
      const proceed = await ctx.ui.confirm(
        "📂 切换目录",
        `当前不在 ai-workspace 内，是否切换到 ${wsPath}？`
      );
      if (!proceed) return false;
      process.chdir(wsPath);
    }
    return true;
  }

  // === Error isolation ===

  function safe<T>(label: string, fn: () => T, fallback?: T): T | undefined {
    try {
      return fn();
    } catch (err) {
      console.error(`[pi-ai-system] ${label} error:`, err);
      return fallback;
    }
  }

  function safeAsync<T>(label: string, fn: () => Promise<T>, fallback?: T): Promise<T | undefined> {
    return fn().catch((err) => {
      console.error(`[pi-ai-system] ${label} error:`, err);
      return fallback;
    });
  }

  // === Events ===

  pi.on("resources_discover", async (event) => {
    return safe("resources_discover", () => ({
      skillPaths: [path.join(__dirname, "agents")],
    }));
  });

  pi.on("input", async (event, ctx) => {
    return safe("input", () => {
      if (event.source === "extension") return { action: "continue" };

      const text = event.text.trim().toLowerCase();
      if (text === "status" || text === "as:status") {
        if (!engine) {
          ctx.ui.notify("💡 暂无活跃工作空间", "warning");
          return { action: "handled" };
        }
        showStatus(engine, ctx);
        return { action: "handled" };
      }

      return { action: "continue" };
    }, { action: "continue" as const });
  });

  pi.on("session_tree", async () => {
    await safeAsync("session_tree", async () => {
      if (!engine) return;
      const session = engine.getSessionStore().loadSession();
      if (session) {
        engine.getSessionStore().saveSession(session);
      }
    });
  });

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "new") {
      restoreSession(ctx);
    }

    loadExtensionConfig();

    if (activeWorkspace) {
      pi.setSessionName(`Workflow: ${activeWorkspace}`);
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestFooterRender = () => tui.requestRender();
      return {
        invalidate() {},
        render(width: number): string[] {
          const parts: string[] = [];
          const branch = footerData.getGitBranch();
          if (branch) parts.push(`🌿${branch}`);
          const wp = guard.getWorkspacePath();
          if (wp) parts.push(`📂${path.basename(wp)}`);
          if (activeWorkspace) parts.push(`📦${activeWorkspace}`);
          if (engine) {
            const s = engine.getSessionStore().loadSession();
            if (s?.currentPhase) parts.push(`⏳${s.currentPhase}`);
          }
          if (parts.length === 0) return [];
          const sep = theme.fg("dim", "│");
          return [parts.join(` ${sep} `)];
        },
        dispose: footerData.onBranchChange(() => tui.requestRender()),
      };
    });

    updateUI(ctx);
  });

  async function saveCurrentSession(): Promise<void> {
    if (!engine) return;
    const session = engine.getSessionStore().loadSession();
    if (session) {
      engine.getSessionStore().saveSession(session);
    }
  }

  pi.on("session_shutdown", async () => {
    await safeAsync("session_shutdown", saveCurrentSession);
  });

  pi.on("session_compact", async () => {
    await safeAsync("session_compact", saveCurrentSession);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await safeAsync("turn_end", async () => {
      updateUI(ctx);
      requestFooterRender?.();
    });
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await safeAsync("agent_settled", async () => {
      updateUI(ctx);
      requestFooterRender?.();
    });
  });

  pi.on("session_before_switch", async () => {
    await safeAsync("session_before_switch", saveCurrentSession);
  });

  pi.on("session_before_fork", async () => {
    await safeAsync("session_before_fork", saveCurrentSession);
  });

  pi.on("project_trust", async (event) => {
    return safe("project_trust", () => {
      if (guard.isInitialized()) {
        const wsPath = guard.getWorkspacePath()!;
        if (path.resolve(event.cwd).startsWith(path.resolve(wsPath))) {
          return { trusted: "yes" as const, remember: true };
        }
      }
      return { trusted: "undecided" as const };
    }, { trusted: "undecided" as const })!;
  });

  pi.on("session_info_changed", async (_event, ctx) => {
    await safeAsync("session_info_changed", async () => {
      requestFooterRender?.();
      updateUI(ctx);
    });
  });

  pi.on("before_agent_start", async (event) => {
    return safe("before_agent_start", () => {
      if (!engine) return;

      const session = engine.getSessionStore().loadSession();
      if (!session) return;

      const lines: string[] = [
        "=== AI Workspace 工作流状态 ===",
        `工作空间: ${session.workspaceName}`,
      ];
      if (session.completedPhases.length > 0) {
        lines.push(`已完成阶段: ${session.completedPhases.join(" → ")}`);
      }
      if (session.currentPhase) {
        lines.push(`当前阶段: ${session.currentPhase}`);
      }
      lines.push("============================");

      return {
        systemPrompt: event.systemPrompt + "\n\n" + lines.join("\n"),
      };
    });
  });

  function extractFilePath(input: Record<string, unknown>): string | undefined {
    return (input.filePath as string | undefined)
      ?? (input.path as string | undefined)
      ?? (input.file_path as string | undefined)
      ?? undefined;
  }

  pi.on("tool_call", async (event, ctx) => {
    await safeAsync("tool_call", async () => {
      const wsPath = guard.getWorkspacePath();
      if (!wsPath) return;

      if (isToolCallEventType("write", event)) {
        const p = extractFilePath(event.input);
        if (p && !path.resolve(p).startsWith(path.resolve(wsPath))) {
          return { block: true, reason: `写入路径 ${p} 不在 ai-workspace (${wsPath}) 内，已拦截` };
        }
      }
      if (isToolCallEventType("edit", event)) {
        const p = extractFilePath(event.input);
        if (p && !path.resolve(p).startsWith(path.resolve(wsPath))) {
          return { block: true, reason: `编辑路径 ${p} 不在 ai-workspace (${wsPath}) 内，已拦截` };
        }
      }
    });
  });

  pi.on("tool_result", async (event) => {
    await safeAsync("tool_result", async () => {
      if (event.toolName === "write" && event.isError) {
        console.error(`[pi-ai-system] write 失败: ${JSON.stringify(event.isError)}`);
      }
      if (event.toolName === "edit" && event.isError) {
        console.error(`[pi-ai-system] edit 失败: ${JSON.stringify(event.isError)}`);
      }
    });
  });

  // === Shortcuts ===

  pi.registerShortcut("ctrl+shift+s", {
    description: "Show workflow status",
    handler: async (ctx) => {
      if (!engine) {
        ctx.ui.notify("💡 暂无活跃工作空间", "warning");
        return;
      }
      showStatus(engine, ctx);
    },
  });

  // === LLM Tools ===

  pi.registerTool({
    name: "workflow_status",
    label: "Workflow Status",
    description: "Get the current AI workspace workflow status — phase and completed phases",
    promptSnippet: "Check what phase the workspace is in and what's been completed",
    promptGuidelines: [
      "Use workflow_status when the user asks about workspace state or progress",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!engine) {
        return {
          content: [{ type: "text", text: "No active workspace session." }],
          details: {},
        };
      }
      const session = engine.getSessionStore().loadSession();
      if (!session) {
        return {
          content: [{ type: "text", text: "No workspace session found. Run /as-bootstrap first." }],
          details: {},
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            workspace: session.workspaceName,
            currentPhase: session.currentPhase,
            completedPhases: session.completedPhases,
          }, null, 2),
        }],
        details: {},
      };
    },
  });

  // === Entry Renderer ===

  // === Commands ===

  function registerPhaseCommand(
    name: string,
    phase: WorkflowPhase,
    needsTaskId: boolean
  ) {
    pi.registerCommand(name, {
      description: `Run ${phase} workflow`,
      getArgumentCompletions: (prefix: string) => getWorkspaceCompletions(prefix),
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        updateUI(ctx);

        if (!await ensureInWorkspace(ctx)) return;

        const parts = parseArgs(args, needsTaskId ? 2 : 1);
        const workspaceName = parts[0];
        const taskId = needsTaskId ? parts[1] : undefined;

        if (!workspaceName) {
          ctx.ui.notify(`💡 用法: /${name} <workspace-name>${needsTaskId ? " <task-id>" : ""}`, "error");
          return;
        }
        if (needsTaskId && !taskId) {
          ctx.ui.notify("💡 用法: /${name} <workspace-name> <task-id>", "error");
          return;
        }

        const eng = getOrCreateEngine(workspaceName, process.cwd());
        activeWorkspace = workspaceName;
        eng.setCtx(ctx);
        eng.setModelSwitcher(async (p) => { await switchPhaseModel(p, ctx.modelRegistry); switchPhaseThinking(p); });
        eng.setEventEmitter((event, data) => pi.events?.emit(event, data));
        const session = eng.getSessionStore().loadSession();
        if (!session) {
          ctx.ui.notify(`❌ 工作空间 '${workspaceName}' 尚未初始化，请先执行 /as-bootstrap ${workspaceName}`, "error");
          return;
        }

        const context: CommandContext = {
          workflow: phase,
          workspaceName,
          taskId,
          autoMode: !!(pi.getFlag("auto")),
        };

        pi.events.emit("workflow:phase_start", { phase, workspaceName, taskId });
        ctx.ui.setWorkingMessage(`▶️ 执行 ${phase} 阶段...`);
        const result = await eng.runPhase(phase, context);
        ctx.ui.setWorkingMessage();

        pi.events.emit("workflow:phase_complete", { phase, workspaceName, taskId, exitCode: result.exitCode, error: result.error });
        updateUI(ctx);
        if (result.exitCode === 0) {
          ctx.ui.notify(`✅ ${phase} 阶段完成`, "info");
        } else {
          ctx.ui.notify(`❌ ${phase} 阶段失败: ${result.error || "未知错误"}`, "error");
        }
      },
    });
  }

  // --- as-init ---

  pi.registerCommand("as-init", {
    description: "Initialize the global ai-workspace (one-time)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (guard.isInitialized()) {
        updateUI(ctx);
        ctx.ui.notify("❌ ai-workspace 已初始化，不可重复初始化", "error");
        return;
      }

      const parts = parseArgs(args, 1);
      const targetPath = parts[0] ? path.resolve(ctx.cwd, parts[0]) : ctx.cwd;
      const confirmed = await ctx.ui.confirm(
        "🚀 初始化工作空间",
        `将 ai-workspace 设置为: ${targetPath}？`
      );
      if (!confirmed) return;

      guard.saveState(targetPath);
      updateUI(ctx);
      ctx.ui.notify(`✅ ai-workspace 已初始化: ${targetPath}`, "info");
    },
  });

  // --- as-bootstrap ---

  pi.registerCommand("as-bootstrap", {
    description: "Initialize a project workspace",
    getArgumentCompletions: (prefix: string) => {
      const wp = guard.getWorkspacePath();
      if (!wp) return null;
      const wsDir = path.join(wp, "workspaces");
      if (!fs.existsSync(wsDir)) return null;
      const names = fs.readdirSync(wsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => ({ value: d.name, label: d.name }));
      const filtered = names.filter(n => n.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      updateUI(ctx);

      if (!await ensureInWorkspace(ctx)) return;

      const [workspaceName] = parseArgs(args, 1);
      if (!workspaceName) {
        ctx.ui.notify("💡 用法: /as-bootstrap <workspace-name>", "error");
        return;
      }

      const eng = getOrCreateEngine(workspaceName, process.cwd());
      activeWorkspace = workspaceName;
      eng.setCtx(ctx);
      eng.setModelSwitcher(async (p) => { await switchPhaseModel(p, ctx.modelRegistry); switchPhaseThinking(p); });
      eng.setEventEmitter((event, data) => pi.events?.emit(event, data));
      ctx.ui.setWorkingMessage(`🚀 初始化工作空间 ${workspaceName}...`);
      const success = await eng.bootstrapWorkspace(workspaceName);
      ctx.ui.setWorkingMessage();
      updateUI(ctx);
      if (success) {
        ctx.ui.notify(`✅ 工作空间 '${workspaceName}' 已就绪`, "info");
      }
    },
  });

  // --- phase commands ---

  registerPhaseCommand("as-prepare", "prepare", false);
  registerPhaseCommand("as-spec", "spec", false);
  registerPhaseCommand("as-setup", "dev-setup", false);
  registerPhaseCommand("as-dev", "develop", true);
  registerPhaseCommand("as-review", "review", true);
  registerPhaseCommand("as-verify", "verify", true);

  // --- as-run ---

  pi.registerCommand("as-run", {
    description: "Run the full workflow chain (prepare → spec → setup → dev → review → verify)",
    getArgumentCompletions: (prefix: string) => {
      const wp = guard.getWorkspacePath();
      if (!wp) return null;
      const wsDir = path.join(wp, "workspaces");
      if (!fs.existsSync(wsDir)) return null;
      const names = fs.readdirSync(wsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => ({ value: d.name, label: d.name }));
      const filtered = names.filter(n => n.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      updateUI(ctx);

      if (!await ensureInWorkspace(ctx)) return;

      const parts = parseArgs(args, 2);
      const workspaceName = parts[0];
      const taskId = parts[1];
      if (!workspaceName || !taskId) {
        ctx.ui.notify("💡 用法: /as-run <workspace-name> <task-id> [--auto]", "error");
        return;
      }

      const eng = getOrCreateEngine(workspaceName, process.cwd());
      activeWorkspace = workspaceName;
      eng.setCtx(ctx);
      eng.setModelSwitcher(async (p) => { await switchPhaseModel(p, ctx.modelRegistry); switchPhaseThinking(p); });
      eng.setEventEmitter((event, data) => pi.events?.emit(event, data));
      const session = eng.getSessionStore().loadSession();
      if (!session) {
        ctx.ui.notify(`❌ 工作空间 '${workspaceName}' 尚未初始化，请先执行 /as-bootstrap ${workspaceName}`, "error");
        return;
      }

      const autoMode = !!(pi.getFlag("auto"));
      const context: CommandContext = {
        workflow: "prepare",
        workspaceName,
        taskId,
        autoMode,
      };

      const phases: WorkflowPhase[] = [
        "prepare",
        "spec",
        "dev-setup",
        "develop",
        "review",
        "verify",
      ];

      ctx.ui.setWorkingMessage("▶️ 执行全流程...");
      pi.events.emit("workflow:chain_start", { workspaceName, taskId, phases });
      const results = await eng.runChain(phases, context);
      ctx.ui.setWorkingMessage();

      pi.events.emit("workflow:chain_complete", { workspaceName, taskId, results });
      updateUI(ctx);
      const successes = results.filter((r) => r.exitCode === 0).length;
      ctx.ui.notify(
        successes === results.length
          ? `🎉 全流程完成: ${successes}/${results.length} 个阶段全部成功`
          : `💡 全流程结束: ${successes}/${results.length} 个阶段成功`,
        successes === results.length ? "info" : "warning"
      );
    },
  });
}
