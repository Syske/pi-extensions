import type { OrchestrationEngine } from "./orchestration-engine";

const PHASE_LABELS: Record<string, string> = {
  bootstrap: "🚀 初始化",
  prepare: "📋 需求分析",
  spec: "📐 规范设计",
  "dev-setup": "🔧 环境配置",
  develop: "💻 开发实现",
  review: "👀 代码审查",
  verify: "✅ 验证",
};

export function getPhasesStatus(
  getEngine: () => OrchestrationEngine | null
): string | undefined {
  const engine = getEngine();
  if (!engine) return;

  const session = engine.getSessionStore().loadSession();
  if (!session) return;

  const parts: string[] = [];

  if (session.completedPhases.length > 0) {
    const labels = session.completedPhases.map(
      (p: string) => PHASE_LABELS[p] || p
    );
    parts.push(labels.join(" ➜ "));
  }

  if (session.currentPhase) {
    const label = PHASE_LABELS[session.currentPhase] || session.currentPhase;
    parts.push(`⏳ ${label}`);
  }

  return parts.length > 0 ? parts.join(" ǀ ") : undefined;
}

export function getWidgetLines(
  getEngine: () => OrchestrationEngine | null
): string[] | undefined {
  const engine = getEngine();
  if (!engine) return;

  const session = engine.getSessionStore().loadSession();
  if (!session) return;

  const lines: string[] = [];

  if (session.completedPhases.length > 0) {
    const labels = session.completedPhases.map(
      (p: string) => PHASE_LABELS[p] || p
    );
    lines.push(`✅ 已完成: ${labels.join(" ➜ ")}`);
  }

  if (session.currentPhase) {
    const label = PHASE_LABELS[session.currentPhase] || session.currentPhase;
    lines.push(`⏳ 当前阶段: ${label}`);
  }

  return lines.length > 0 ? lines : undefined;
}
