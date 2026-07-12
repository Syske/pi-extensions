# pi-extensions

Collection of [Pi Coding Agent](https://pi.dev) extensions for AI-assisted development workflow orchestration.

## Extensions

| Extension | Description | Dependencies | Commands / Tools |
|-----------|-------------|-------------|------------------|
| **pi-ai-system** | Workflow orchestrator — phases (prepare → spec → develop → review → verify), model switching, workspace guard, tool boundary enforcement | pi-subagent, pi-workspace-guard | `/as-init`, `/as-bootstrap`, `/as-prepare`, `/as-spec`, `/as-setup`, `/as-dev`, `/as-review`, `/as-verify`, `/as-run`, `workflow_status` tool |
| **pi-todo** | Standalone todo management — list, add, complete, persist. Driven by events from pi-ai-system | none (pi-events) | `/todos` |
| **pi-session-memory** | Session memory extension — tracks tool usage, phase transitions, knowledge patterns. Auto-injects memory context into system prompt | none | `/memory-scan`, `/memory-status`, `?memory` quick query |
| **pi-subagent** | Generic sub-agent runner — spawn isolated Pi sub-sessions with timeout, configurable token scanning, and artifact collection | none | Class library (SubagentRunner, TokenPattern) |
| **pi-workspace-guard** | Workspace boundary guard — persist workspace root to `~/.pi/`, enforce path limits, check project trust | none | Class library (WorkspaceGuard) |

## Architecture

### Dependency Graph

```
pi-ai-system  ────pi-subagent──────── (class library)
             │
             ├────pi-workspace-guard── (class library)
             │
             └────pi-todo ──────────── (pi.events: todo:add, todo:complete, todo:rollover)
```

`pi-session-memory` is independent and operates solely through Pi lifecycle events.

### Event Flow

```
User command (/as-dev my-workspace task-42)
  ↓
pi-ai-system (parse args → OrchestrationEngine.runPhase)
  ├── emit(todo:add, { category, items })        → pi-todo picks up
  ├── WorkflowRunner.spawn (ctx.newSession)
  │     └── sub-agent messages scanned for tokens
  │           ├── [ARTIFACT: path]                → collected in result
  │           └── [TODO_COMPLETE: id]             → emit(todo:complete) → pi-todo picks up
  ├── emit(todo:rollover, { from, to })           → pi-todo picks up
  └── session.json updated
```

## Installation

Each extension can be used independently. Clone the repo and symlink or copy what you need.

### Prerequisites

- [Pi Coding Agent](https://pi.dev) installed
- Node.js 18+

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/<your-org>/pi-extensions.git
cd pi-extensions

# (Optional) Install dependencies for extensions that need them
cd pi-ai-system && npm install && cd ..

# Symlink individual extensions to Pi's extension directory
# Windows (PowerShell):
New-Item -ItemType Junction -Path "$env:USERPROFILE\.pi\agent\extensions\pi-ai-system" -Target "$pwd\pi-ai-system"

# Linux / macOS:
ln -sf "$PWD/pi-ai-system" ~/.pi/agent/extensions/pi-ai-system
```

Restart Pi or run `/reload` to pick up new extensions.

### Per-Extension Install

```bash
# pi-subagent (class library, no commands)
ln -sf "$PWD/pi-subagent" ~/.pi/agent/extensions/pi-subagent

# pi-workspace-guard (class library, no commands)
ln -sf "$PWD/pi-workspace-guard" ~/.pi/agent/extensions/pi-workspace-guard

# pi-todo (/todos command)
ln -sf "$PWD/pi-todo" ~/.pi/agent/extensions/pi-todo

# pi-session-memory (/memory-scan, memory auto-inject)
ln -sf "$PWD/pi-session-memory" ~/.pi/agent/extensions/pi-session-memory

# pi-ai-system (workflow commands) — requires pi-subagent, pi-workspace-guard, and pi-todo
cd pi-ai-system && npm install && cd ..
ln -sf "$PWD/pi-ai-system" ~/.pi/agent/extensions/pi-ai-system
```

## Usage

### Workflow Orchestration (pi-ai-system)

```bash
# 1. Initialize workspace root (one-time)
/as-init /path/to/projects

# 2. Bootstrap a project workspace
/as-bootstrap my-project

# 3. Run individual phases
/as-prepare my-project
/as-spec my-project
/as-dev my-project task-42

# 4. Or run the full chain
/as-run my-project task-42

# 5. Use --auto to skip confirmation prompts
/as-run my-project task-42 --auto

# 6. Show status
/status
```

### Todo Management (pi-todo)

```bash
/todos           # List all todos
```

### Session Memory (pi-session-memory)

```bash
/memory-scan     # Display tool stats, phase transitions, knowledge patterns
/memory-status   # Show memory state summary
?memory          # Quick: show recent knowledge patterns
?memory <keyword> # Quick: filter by keyword
```

## Configuration

### pi-ai-system

`pi-ai-system/extension-config.json` — phase-model mapping and thinking levels:

```json
{
  "phaseModels": {
    "spec":    { "provider": "anthropic", "modelId": "claude-sonnet-5" },
    "develop": { "provider": "anthropic", "modelId": "claude-sonnet-5" },
    "review":  { "provider": "anthropic", "modelId": "claude-haiku-5" }
  },
  "phaseThinkingLevels": {
    "spec":    "high",
    "develop": "high",
    "review":  "medium"
  }
}
```

### pi-session-memory

`pi-session-memory/extension-config.json`:

```json
{
  "injectMemoryOnStart": true,
  "autoSummarize": true,
  "maxKnowledgeEntries": 100
}
```

## Development

```bash
# Install dependencies for all extensions
cd pi-ai-system && npm install && cd ..
cd pi-subagent && npm install && cd ..
cd pi-workspace-guard && npm install && cd ..

# Type-check all extensions
cd pi-ai-system && npx tsc --noEmit && cd ..
cd pi-subagent && npx tsc --noEmit && cd ..
cd pi-workspace-guard && npx tsc --noEmit && cd ..

# Build (compile .ts → .js)
cd pi-ai-system && npm run build && cd ..
```

## License

MIT
