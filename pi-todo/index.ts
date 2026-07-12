import { type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { type TodoItem, type TodoSnapshot } from "./types";

class TodoStore {
  private items: TodoItem[] = [];
  private counter = 0;

  add(category: string, description: string): void {
    this.items.push({
      id: `todo-${category}-${++this.counter}`,
      category,
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  }

  addBatch(category: string, descriptions: string[]): TodoItem[] {
    return descriptions.map((desc) => {
      const item: TodoItem = {
        id: `todo-${category}-${++this.counter}`,
        category,
        description: desc,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
      };
      this.items.push(item);
      return item;
    });
  }

  complete(id: string): string | null {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.status = "completed";
      return item.id;
    }
    return null;
  }

  getActive(category?: string): TodoItem[] {
    const active = this.items.filter((i) => i.status !== "completed");
    if (category) return active.filter((i) => i.category === category);
    return active;
  }

  getAll(): TodoItem[] {
    return [...this.items];
  }

  rollover(fromCategory: string, toCategory: string): void {
    const unfinished = this.items.filter(
      (i) => i.category === fromCategory && i.status !== "completed"
    );
    for (const item of unfinished) {
      this.items.push({
        ...item,
        id: `todo-${toCategory}-${++this.counter}`,
        category: toCategory,
        createdAt: new Date().toISOString(),
      });
    }
  }

  toSnapshot(): TodoSnapshot {
    return { items: [...this.items], counter: this.counter };
  }

  loadSnapshot(data: TodoSnapshot): void {
    this.items = data.items.map((item) => ({ ...item }));
    this.counter = data.counter;
  }
}

export default function install(pi: ExtensionAPI) {
  const store = new TodoStore();

  // ── Session persistence ─────────────────────────────
  // 每次 persist 都 Append 最新快照；session_start 取最后一个条目而非第一个，
  // 因此即使有多次 Append，恢复的始终是最新状态。

  function persistToSession(): void {
    const snapshot = store.toSnapshot();
    if (snapshot.items.length > 0) {
      pi.appendEntry("todo", snapshot);
    }
  }

  // ── Custom events (pi.on typing is strict; cast is safe at runtime) ──

  (pi as any).on("todo:add", async (data: { category: string; items: string[] }) => {
    if (!data?.category || !data?.items?.length) return;
    store.addBatch(data.category, data.items);
  });

  (pi as any).on("todo:complete", async (data: { todoId: string }) => {
    if (!data?.todoId) return;
    store.complete(data.todoId);
  });

  (pi as any).on("todo:rollover", async (data: { from: string; to: string }) => {
    if (!data?.from || !data?.to) return;
    store.rollover(data.from, data.to);
  });

  (pi as any).on("todo:save", async () => {
    persistToSession();
  });

  // ── Session events ─────────────────────────────────

  pi.on("session_start", async (event, ctx) => {
    const reason = event.reason;
    if (reason === "new") return;

    // 取最后一个 todo 条目（最新的快照）
    for (const se of ctx.sessionManager.getEntries()) {
      if (se.type === "custom" && se.customType === "todo" && se.data && typeof se.data === "object" && "items" in se.data) {
        store.loadSnapshot(se.data as TodoSnapshot);
      }
    }
  });

  pi.on("session_shutdown", async () => {
    persistToSession();
  });

  pi.on("session_before_switch", async () => {
    persistToSession();
  });

  pi.on("session_before_fork", async () => {
    persistToSession();
  });

  // ── System prompt injection ────────────────────────

  pi.on("before_agent_start", async (event) => {
    const pending = store.getActive();
    if (pending.length === 0) return;

    const lines: string[] = [
      "=== 待办事项 ===",
    ];
    for (const todo of pending) {
      lines.push(`  - [${todo.status}] ${todo.description} (${todo.id})`);
    }
    lines.push("================");

    return {
      systemPrompt: event.systemPrompt + "\n\n" + lines.join("\n"),
    };
  });

  // ── LLM Tools ──────────────────────────────────────

  pi.registerTool({
    name: "list_todos",
    label: "List Todos",
    description: "List all pending todos, optionally filtered by category",
    promptSnippet: "Show what work items are pending",
    promptGuidelines: [
      "Use list_todos when the user asks what needs to be done next",
    ],
    parameters: Type.Object({
      category: Type.Optional(Type.String({ description: "Filter by category (optional)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let todos = store.getActive();
      if (params.category) {
        todos = todos.filter((t) => t.category === params.category);
      }
      if (todos.length === 0) {
        return {
          content: [{ type: "text", text: "No pending todos." }],
          details: {},
        };
      }
      const formatted = todos.map((t) => `[${t.category}] ${t.description} (${t.id})`).join("\n");
      return {
        content: [{ type: "text", text: formatted }],
        details: { todos: todos.map((t) => ({ id: t.id, category: t.category, description: t.description, status: t.status })) },
      };
    },
  });

  pi.registerTool({
    name: "complete_todo",
    label: "Complete Todo",
    description: "Mark a todo item as completed by its ID",
    promptSnippet: "Mark a work item as done",
    promptGuidelines: [
      "Use complete_todo when the user says a task is done or finished",
    ],
    parameters: Type.Object({
      todoId: Type.String({ description: "The ID of the todo to mark as completed (e.g. todo-prepare-1)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = store.complete(params.todoId);
      if (!result) {
        return {
          content: [{ type: "text", text: `❌ Todo "${params.todoId}" not found.` }],
          isError: true,
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: `✅ Todo "${params.todoId}" marked as completed.` }],
        details: {},
      };
    },
  });

  // ── Commands ───────────────────────────────────────

  function showTodos(ctx: ExtensionContext | ExtensionCommandContext): void {
    const pending = store.getActive();
    if (pending.length === 0) {
      ctx.ui.notify("✅ 暂无待办事项", "info");
      return;
    }
    const byCategory = new Map<string, TodoItem[]>();
    for (const todo of pending) {
      const list = byCategory.get(todo.category) || [];
      list.push(todo);
      byCategory.set(todo.category, list);
    }
    let output = "📋 待办事项\n";
    for (const [cat, items] of byCategory) {
      output += `\n[${cat}]:\n`;
      for (const item of items) {
        output += `  - ${item.description} (${item.id})\n`;
      }
    }
    ctx.ui.notify(output, "info");
  }

  pi.registerCommand("todos", {
    description: "Show all pending todos",
    handler: async (_args, ctx) => {
      showTodos(ctx);
    },
  });

  // ── Input handler ──────────────────────────────────

  pi.on("input", async (event, ctx) => {
    const text = event.text.trim().toLowerCase();
    if (text === "todos") {
      showTodos(ctx);
      return { action: "handled" as const };
    }
    return { action: "continue" as const };
  });

  // ── Entry renderer ─────────────────────────────────

  pi.registerEntryRenderer("todo", (entry) => {
    const data = entry.data as TodoSnapshot | undefined;
    if (!data) return;
    const pending = data.items.filter(t => t.status !== "completed").length;
    const done = data.items.length - pending;
    return new Text(`📋 ${pending} 待办 (${done}✓)`);
  });
}
