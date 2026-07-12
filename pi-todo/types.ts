export interface TodoItem {
  id: string;
  category: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
}

export interface TodoSnapshot {
  items: TodoItem[];
  counter: number;
}
