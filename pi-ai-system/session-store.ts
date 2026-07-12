import * as fs from "fs";
import * as path from "path";
import { SessionState, WorkspaceConfig } from "./types";

export class SessionStore {
  private memory = new Map<string, any>();
  private workspacePath: string;

  constructor(workspaceName: string, workspacesRoot?: string) {
    const root = workspacesRoot || path.join(process.cwd(), "workspaces");
    this.workspacePath = path.join(root, workspaceName);
  }

  get<T>(key: string): T | undefined {
    return this.memory.get(key) as T | undefined;
  }

  set(key: string, value: any): void {
    this.memory.set(key, value);
  }

  resolvePath(configPath: string): string {
    if (path.isAbsolute(configPath)) {
      return configPath;
    }
    return path.join(this.workspacePath, configPath);
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  loadOrCreateConfig(): WorkspaceConfig {
    const configFile = path.join(this.workspacePath, "pi-orchestrator.yaml");
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, "utf-8");
      return this.parseConfig(raw);
    }
    return {
      version: 1,
      paths: {
        specs: "specs",
        contracts: "contracts",
        tasks: "tasks/cards",
        contexts: "contexts",
      },
    };
  }

  saveConfig(config: WorkspaceConfig): void {
    const configFile = path.join(this.workspacePath, "pi-orchestrator.yaml");
    const yaml = `version: ${config.version}\npaths:\n  specs: ${config.paths.specs}\n  contracts: ${config.paths.contracts}\n  tasks: ${config.paths.tasks}\n  contexts: ${config.paths.contexts}\n`;
    fs.writeFileSync(configFile, yaml, "utf-8");
  }

  private parseConfig(raw: string): WorkspaceConfig {
    const lines = raw.split("\n");
    const config: WorkspaceConfig = {
      version: 1,
      paths: { specs: "specs", contracts: "contracts", tasks: "tasks/cards", contexts: "contexts" },
    };
    let inPaths = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("version:")) {
        config.version = parseInt(trimmed.split(":")[1].trim(), 10);
      } else if (trimmed === "paths:") {
        inPaths = true;
      } else if (inPaths && trimmed.startsWith("specs:")) {
        config.paths.specs = trimmed.split(":")[1].trim();
      } else if (inPaths && trimmed.startsWith("contracts:")) {
        config.paths.contracts = trimmed.split(":")[1].trim();
      } else if (inPaths && trimmed.startsWith("tasks:")) {
        config.paths.tasks = trimmed.split(":")[1].trim();
      } else if (inPaths && trimmed.startsWith("contexts:")) {
        config.paths.contexts = trimmed.split(":")[1].trim();
      } else if (inPaths && trimmed.startsWith("version:")) {
        inPaths = false;
      }
    }
    return config;
  }

  loadSession(): SessionState | null {
    const sessionFile = path.join(this.workspacePath, "session.json");
    if (fs.existsSync(sessionFile)) {
      return JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    }
    return null;
  }

  saveSession(session: SessionState): void {
    const sessionFile = path.join(this.workspacePath, "session.json");
    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), "utf-8");
  }

  persist(phase: string, artifactPaths: string[]): void {
    const session = this.loadSession() || {
      workspaceName: path.basename(this.workspacePath),
      completedPhases: [],
      status: "active",
      artifacts: {},
    };
    if (!session.completedPhases.includes(phase as any)) {
      session.completedPhases.push(phase as any);
    }
    if (!session.artifacts[phase]) {
      session.artifacts[phase] = [];
    }
    session.artifacts[phase].push(...artifactPaths);
    this.saveSession(session);
  }
}
