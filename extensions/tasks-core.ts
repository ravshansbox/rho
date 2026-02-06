/**
 * Tasks Core -- pure functions for the lightweight task queue.
 *
 * Separated from tasks.ts for testability without pi-coding-agent imports.
 * Persists to ~/.rho/tasks.jsonl (one JSON object per line).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { rhoDir, tasksFile } from "./workspace.ts";

// ---- Types ----

export type TaskPriority = "urgent" | "high" | "normal" | "low";
export type TaskStatus = "pending" | "done";

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  created: string; // ISO 8601
  due: string | null; // YYYY-MM-DD or null
  completedAt: string | null; // ISO 8601 or null
}

export interface TaskAddParams {
  description: string;
  priority?: TaskPriority;
  tags?: string;
  due?: string;
}

export interface TaskResult {
  ok: boolean;
  message: string;
  task?: Task;
  tasks?: Task[];
  count?: number;
}

// ---- Constants ----

export const RHO_DIR = rhoDir();
export const TASKS_PATH = tasksFile();

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const VALID_PRIORITIES: TaskPriority[] = ["urgent", "high", "normal", "low"];

// ---- ID Generation ----

export function generateId(existing: Task[]): string {
  const ids = new Set(existing.map((t) => t.id));
  for (let i = 0; i < 100; i++) {
    const id = randomBytes(4).toString("hex"); // 8 hex chars
    if (!ids.has(id)) return id;
  }
  // Extremely unlikely fallback
  return randomBytes(8).toString("hex");
}

// ---- Persistence ----

export function loadTasks(path: string = TASKS_PATH): Task[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return [];
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const parsed = JSON.parse(line) as Task;
        // Ensure defaults for fields that might be missing
        if (!parsed.tags) parsed.tags = [];
        if (!parsed.due) parsed.due = null;
        if (!parsed.completedAt) parsed.completedAt = null;
        if (!parsed.priority) parsed.priority = "normal";
        if (!parsed.status) parsed.status = "pending";
        return parsed;
      });
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[], path: string = TASKS_PATH): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const lines = tasks.map((t) => JSON.stringify(t));
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
}

// ---- Task Operations ----

export function addTask(params: TaskAddParams, path: string = TASKS_PATH): TaskResult {
  const desc = params.description?.trim();
  if (!desc) {
    return { ok: false, message: "Error: description is required" };
  }

  const priority = params.priority || "normal";
  if (!VALID_PRIORITIES.includes(priority)) {
    return {
      ok: false,
      message: `Error: invalid priority '${priority}'. Must be: ${VALID_PRIORITIES.join(", ")}`,
    };
  }

  // Parse tags from comma-separated string
  const tags = params.tags
    ? params.tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];

  // Validate due date format if provided
  const due = params.due?.trim() || null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return {
      ok: false,
      message: `Error: invalid due date '${due}'. Use YYYY-MM-DD format.`,
    };
  }

  const tasks = loadTasks(path);
  const task: Task = {
    id: generateId(tasks),
    description: desc,
    status: "pending",
    priority,
    tags,
    created: new Date().toISOString(),
    due,
    completedAt: null,
  };

  tasks.push(task);
  saveTasks(tasks, path);

  return { ok: true, message: `Task added: [${task.id}] ${desc}`, task };
}

export function listTasks(
  filter?: string,
  path: string = TASKS_PATH
): TaskResult {
  const tasks = loadTasks(path);

  let filtered: Task[];
  if (!filter || filter === "pending") {
    filtered = tasks.filter((t) => t.status === "pending");
  } else if (filter === "all") {
    filtered = tasks;
  } else if (filter === "done") {
    filtered = tasks.filter((t) => t.status === "done");
  } else {
    // Filter by tag
    const tag = filter.toLowerCase();
    filtered = tasks.filter(
      (t) => t.status === "pending" && t.tags.includes(tag)
    );
  }

  // Sort: priority order, then created date (newest first within same priority)
  filtered.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.created > b.created ? -1 : a.created < b.created ? 1 : 0;
  });

  if (filtered.length === 0) {
    const label = filter === "all" ? "tasks" : filter === "done" ? "completed tasks" : "pending tasks";
    return { ok: true, message: `No ${label}.`, tasks: [], count: 0 };
  }

  const lines = filtered.map((t) => formatTask(t));
  const header =
    filter === "all"
      ? `${filtered.length} task(s):`
      : filter === "done"
        ? `${filtered.length} completed task(s):`
        : `${filtered.length} pending task(s):`;

  return {
    ok: true,
    message: `${header}\n${lines.join("\n")}`,
    tasks: filtered,
    count: filtered.length,
  };
}

export function completeTask(id: string, path: string = TASKS_PATH): TaskResult {
  if (!id?.trim()) {
    return { ok: false, message: "Error: task ID is required" };
  }

  const tasks = loadTasks(path);
  const task = findTaskById(tasks, id.trim());

  if (!task) {
    return { ok: false, message: `Error: task '${id}' not found` };
  }

  if (task.status === "done") {
    return { ok: true, message: `Task [${task.id}] is already done.`, task };
  }

  task.status = "done";
  task.completedAt = new Date().toISOString();
  saveTasks(tasks, path);

  return { ok: true, message: `Done: [${task.id}] ${task.description}`, task };
}

export function removeTask(id: string, path: string = TASKS_PATH): TaskResult {
  if (!id?.trim()) {
    return { ok: false, message: "Error: task ID is required" };
  }

  const tasks = loadTasks(path);
  const task = findTaskById(tasks, id.trim());

  if (!task) {
    return { ok: false, message: `Error: task '${id}' not found` };
  }

  const remaining = tasks.filter((t) => t.id !== task.id);
  saveTasks(remaining, path);

  return {
    ok: true,
    message: `Removed: [${task.id}] ${task.description}`,
    task,
  };
}

export function clearDone(path: string = TASKS_PATH): TaskResult {
  const tasks = loadTasks(path);
  const done = tasks.filter((t) => t.status === "done");
  const remaining = tasks.filter((t) => t.status !== "done");

  if (done.length === 0) {
    return { ok: true, message: "No completed tasks to clear.", count: 0 };
  }

  saveTasks(remaining, path);
  return {
    ok: true,
    message: `Cleared ${done.length} completed task(s).`,
    count: done.length,
  };
}

// ---- Heartbeat Integration ----

/**
 * Build a tasks section for the heartbeat prompt.
 * Returns null if no pending tasks exist.
 */
export function buildHeartbeatSection(path: string = TASKS_PATH): string | null {
  const tasks = loadTasks(path);
  const pending = tasks.filter((t) => t.status === "pending");

  if (pending.length === 0) return null;

  // Sort by priority
  pending.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    return pa - pb;
  });

  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lines = pending.map((t) => {
    let line = `- [${t.id}] ${t.description}`;
    if (t.priority !== "normal") line += ` (${t.priority})`;
    if (t.due) {
      if (t.due < now) {
        line += ` **OVERDUE** (due ${t.due})`;
      } else {
        line += ` (due ${t.due})`;
      }
    }
    if (t.tags.length > 0) line += ` [${t.tags.join(", ")}]`;
    return line;
  });

  return `Pending tasks (${pending.length}):\n${lines.join("\n")}`;
}

// ---- Helpers ----

/**
 * Find a task by full ID or prefix match (minimum 4 chars).
 */
export function findTaskById(tasks: Task[], idPrefix: string): Task | null {
  const prefix = idPrefix.toLowerCase();
  // Exact match first
  const exact = tasks.find((t) => t.id === prefix);
  if (exact) return exact;
  // Prefix match (min 4 chars to avoid ambiguity)
  if (prefix.length < 4) return null;
  const matches = tasks.filter((t) => t.id.startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

export function formatTask(task: Task): string {
  const status = task.status === "done" ? "[x]" : "[ ]";
  let line = `${status} [${task.id}] ${task.description}`;
  if (task.priority !== "normal") line += ` (${task.priority})`;
  if (task.due) line += ` due:${task.due}`;
  if (task.tags.length > 0) line += ` #${task.tags.join(" #")}`;
  if (task.completedAt) {
    const when = task.completedAt.slice(0, 10);
    line += ` done:${when}`;
  }
  return line;
}

// Default export (no-op) to prevent pi from treating this as an extension
export default function () {}
