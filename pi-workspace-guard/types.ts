export interface WorkspaceState {
  workspacePath: string;
  initializedAt: string;
  meta?: Record<string, unknown>;
}

export interface WorkspaceGuardOptions {
  stateFileName?: string;
  stateDir?: string;
}
