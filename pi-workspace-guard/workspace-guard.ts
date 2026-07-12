import * as fs from "fs";
import * as path from "path";
import { WorkspaceState, WorkspaceGuardOptions } from "./types";

const DEFAULT_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || process.cwd(),
  ".pi",
);
const DEFAULT_FILE = "workspace-state.json";

export class WorkspaceGuard {
  private stateFile: string;

  constructor(options?: WorkspaceGuardOptions) {
    const dir = options?.stateDir ?? DEFAULT_DIR;
    const name = options?.stateFileName ?? DEFAULT_FILE;
    this.stateFile = path.join(dir, name);
  }

  loadState(): WorkspaceState | null {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
      }
    } catch {}
    return null;
  }

  saveState(workspacePath: string, meta?: Record<string, unknown>): void {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const state: WorkspaceState = {
      workspacePath,
      initializedAt: new Date().toISOString(),
    };
    if (meta) state.meta = meta;
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), "utf-8");
  }

  isInitialized(): boolean {
    return this.loadState() !== null;
  }

  getWorkspacePath(): string | null {
    const state = this.loadState();
    return state ? state.workspacePath : null;
  }

  isInsideWorkspace(cwd: string): boolean {
    const state = this.loadState();
    if (!state) return false;
    const relative = path.relative(state.workspacePath, cwd);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }
}
