import * as fs from "fs";
import * as path from "path";
import { WorkflowPhase, WorkspaceConfig } from "./types";
import { SessionStore } from "./session-store";

const AGENTS_DIR = path.join(__dirname, "agents");

export class PromptResolver {
  constructor(private sessionStore: SessionStore) {}

  resolve(
    phase: WorkflowPhase,
    config: WorkspaceConfig,
  ): string {
    const templatePath = path.join(AGENTS_DIR, `${phase}-agent.md`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Agent template not found: ${templatePath}`);
    }

    let template = fs.readFileSync(templatePath, "utf-8");
    template = template.replace(/^---[\s\S]*?---\n*/m, "");

    const workspacePath = this.sessionStore.getWorkspacePath();
    const specDir = this.sessionStore.resolvePath(config.paths.specs);
    const contractsDir = this.sessionStore.resolvePath(config.paths.contracts);
    const tasksDir = this.sessionStore.resolvePath(config.paths.tasks);
    const contextsDir = this.sessionStore.resolvePath(config.paths.contexts);

    template = template
      .replace(/\{workspace_path\}/g, workspacePath)
      .replace(/\{spec_dir\}/g, specDir)
      .replace(/\{contracts_dir\}/g, contractsDir)
      .replace(/\{tasks_dir\}/g, tasksDir)
      .replace(/\{contexts_dir\}/g, contextsDir)
      .replace(/\{workspace_name\}/g, path.basename(workspacePath))
      .replace(/\{todo_list\}/g, "");

    return template;
  }
}
