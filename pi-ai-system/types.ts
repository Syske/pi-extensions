export type WorkflowPhase =
  | "bootstrap"
  | "prepare"
  | "spec"
  | "dev-setup"
  | "develop"
  | "review"
  | "verify";

export interface CommandContext {
  workflow: WorkflowPhase;
  workspaceName: string;
  taskId?: string;
  autoMode: boolean;
}

export interface WorkspaceConfig {
  version: number;
  paths: {
    specs: string;
    contracts: string;
    tasks: string;
    contexts: string;
  };
}

export interface SessionState {
  workspaceName: string;
  completedPhases: WorkflowPhase[];
  currentPhase?: WorkflowPhase;
  status: "active" | "interrupted" | "complete";
  artifacts: Record<string, string[]>;
}

export interface PhaseResult {
  phase: WorkflowPhase;
  exitCode: number;
  artifacts: string[];
  error?: string;
}
