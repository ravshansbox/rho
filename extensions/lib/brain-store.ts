/**
 * extensions/lib/brain-store.ts
 *
 * Single source of truth for reading/writing brain.jsonl.
 * Append-only event log with schema validation, file locking,
 * and sequential fold into materialized state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import { withFileLock } from "./file-lock.ts";

// ── Entry Types ───────────────────────────────────────────────────

export interface BrainEntry {
  id: string;
  type: string;
  created: string;
}

export interface BehaviorEntry extends BrainEntry {
  type: "behavior";
  category: "do" | "dont" | "value";
  text: string;
}

export interface IdentityEntry extends BrainEntry {
  type: "identity";
  key: string;
  value: string;
}

export interface UserEntry extends BrainEntry {
  type: "user";
  key: string;
  value: string;
}

export interface LearningEntry extends BrainEntry {
  type: "learning";
  text: string;
  source?: string;
  scope?: "global" | "project";
  projectPath?: string;
}

export interface PreferenceEntry extends BrainEntry {
  type: "preference";
  category: string;
  text: string;
}

export interface ContextEntry extends BrainEntry {
  type: "context";
  project: string;
  path: string;
  content: string;
}

export interface TaskEntry extends BrainEntry {
  type: "task";
  description: string;
  status: "pending" | "done";
  priority: "urgent" | "high" | "normal" | "low";
  tags: string[];
  due: string | null;
  completedAt: string | null;
}

export interface ReminderEntry extends BrainEntry {
  type: "reminder";
  text: string;
  enabled: boolean;
  cadence: { kind: "interval"; every: string } | { kind: "daily"; at: string };
  priority: "urgent" | "high" | "normal" | "low";
  tags: string[];
  last_run: string | null;
  next_due: string | null;
  last_result: "ok" | "error" | "skipped" | null;
  last_error: string | null;
}

export interface TombstoneEntry extends BrainEntry {
  type: "tombstone";
  target_id: string;
  target_type: string;
  reason: string;
}

export interface MetaEntry extends BrainEntry {
  type: "meta";
  key: string;
  value: string;
}

// ── Materialized State ────────────────────────────────────────────

export interface MaterializedBrain {
  behaviors: BehaviorEntry[];
  identity: Map<string, IdentityEntry>;
  user: Map<string, UserEntry>;
  learnings: LearningEntry[];
  preferences: PreferenceEntry[];
  contexts: ContextEntry[];
  tasks: TaskEntry[];
  reminders: ReminderEntry[];
  meta: Map<string, MetaEntry>;
  tombstoned: Set<string>;
}

// ── Schema Registry ───────────────────────────────────────────────

export const SCHEMA_REGISTRY: Record<
  string,
  { required: string[]; enums?: Record<string, string[]> }
> = {
  behavior:   { required: ["category", "text"], enums: { category: ["do", "dont", "value"] } },
  identity:   { required: ["key", "value"] },
  user:       { required: ["key", "value"] },
  learning:   { required: ["text"] },
  preference: { required: ["text", "category"] },
  context:    { required: ["project", "path", "content"] },
  task:       { required: ["description"] },
  reminder:   { required: ["text", "cadence", "enabled"] },
  tombstone:  { required: ["target_id", "target_type", "reason"] },
  meta:       { required: ["key", "value"] },
};

// ── Constants ─────────────────────────────────────────────────────

const BRAIN_DIR = path.join(os.homedir(), ".rho", "brain");
const BRAIN_PATH = path.join(BRAIN_DIR, "brain.jsonl");

export { BRAIN_DIR, BRAIN_PATH };

// ── validateEntry ─────────────────────────────────────────────────

export function validateEntry(
  entry: any,
): { ok: true } | { ok: false; error: string } {
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: "entry must be an object" };
  }
  if (typeof entry.id !== "string" || !entry.id) {
    return { ok: false, error: "entry requires id (string)" };
  }
  if (typeof entry.type !== "string" || !entry.type) {
    return { ok: false, error: "entry requires type (string)" };
  }
  if (typeof entry.created !== "string" || !entry.created) {
    return { ok: false, error: "entry requires created (ISO 8601 string)" };
  }

  const schema = SCHEMA_REGISTRY[entry.type];
  if (!schema) {
    return { ok: false, error: `unknown type "${entry.type}"` };
  }

  // Check required fields
  for (const field of schema.required) {
    const val = entry[field];
    if (val === undefined || val === null) {
      return {
        ok: false,
        error: `${entry.type} requires ${field}`,
      };
    }
  }

  // Check enum constraints
  if (schema.enums) {
    for (const [field, allowed] of Object.entries(schema.enums)) {
      const val = entry[field];
      if (val !== undefined && val !== null && !allowed.includes(val)) {
        return {
          ok: false,
          error: `${entry.type} field "${field}" must be one of: ${allowed.join(", ")} (got "${val}")`,
        };
      }
    }
  }

  return { ok: true };
}

// ── deterministicId ───────────────────────────────────────────────

export function deterministicId(type: string, naturalKey: string): string {
  return crypto
    .createHash("sha256")
    .update(`${type}:${naturalKey}`)
    .digest("hex")
    .slice(0, 8);
}

// ── readBrain ─────────────────────────────────────────────────────

export function readBrain(filePath: string): {
  entries: BrainEntry[];
  stats: { total: number; badLines: number; truncatedTail: boolean };
} {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { entries: [], stats: { total: 0, badLines: 0, truncatedTail: false } };
    }
    throw err;
  }

  if (!raw || !raw.trim()) {
    return { entries: [], stats: { total: 0, badLines: 0, truncatedTail: false } };
  }

  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");

  const entries: BrainEntry[] = [];
  let badLines = 0;
  let truncatedTail = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      const parsed = JSON.parse(line);
      entries.push(parsed as BrainEntry);
    } catch {
      // If this is the last line and file doesn't end with \n → truncated tail
      if (i === lines.length - 1 && !endsWithNewline) {
        truncatedTail = true;
      } else {
        badLines++;
      }
    }
  }

  return {
    entries,
    stats: { total: entries.length, badLines, truncatedTail },
  };
}

// ── foldBrain ─────────────────────────────────────────────────────

export function foldBrain(entries: BrainEntry[]): MaterializedBrain {
  const brain: MaterializedBrain = {
    behaviors: [],
    identity: new Map(),
    user: new Map(),
    learnings: [],
    preferences: [],
    contexts: [],
    tasks: [],
    reminders: [],
    meta: new Map(),
    tombstoned: new Set(),
  };

  for (const entry of entries) {
    if (entry.type === "tombstone") {
      const ts = entry as TombstoneEntry;
      brain.tombstoned.add(ts.target_id);
      // Remove from collections
      removeById(brain, ts.target_id, ts.target_type);
      continue;
    }

    // If this id was previously tombstoned, the new entry resurrects it
    if (brain.tombstoned.has(entry.id)) {
      brain.tombstoned.delete(entry.id);
    }

    switch (entry.type) {
      case "behavior":
        upsertArray(brain.behaviors, entry as BehaviorEntry);
        break;
      case "identity":
        brain.identity.set((entry as IdentityEntry).key, entry as IdentityEntry);
        break;
      case "user":
        brain.user.set((entry as UserEntry).key, entry as UserEntry);
        break;
      case "learning":
        upsertArray(brain.learnings, entry as LearningEntry);
        break;
      case "preference":
        upsertArray(brain.preferences, entry as PreferenceEntry);
        break;
      case "context":
        upsertArray(brain.contexts, entry as ContextEntry);
        break;
      case "task":
        upsertArray(brain.tasks, entry as TaskEntry);
        break;
      case "reminder":
        upsertArray(brain.reminders, entry as ReminderEntry);
        break;
      case "meta":
        brain.meta.set((entry as MetaEntry).key, entry as MetaEntry);
        break;
      // Unknown types silently ignored during fold
    }
  }

  return brain;
}

/** Replace entry with same id in array, or push if new. */
function upsertArray<T extends BrainEntry>(arr: T[], entry: T): void {
  const idx = arr.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    arr[idx] = entry;
  } else {
    arr.push(entry);
  }
}

/** Remove an entry by id from the correct collection based on target_type. */
function removeById(brain: MaterializedBrain, id: string, targetType: string): void {
  switch (targetType) {
    case "behavior":
      brain.behaviors = brain.behaviors.filter((e) => e.id !== id);
      break;
    case "identity":
      for (const [k, v] of brain.identity) {
        if (v.id === id) { brain.identity.delete(k); break; }
      }
      break;
    case "user":
      for (const [k, v] of brain.user) {
        if (v.id === id) { brain.user.delete(k); break; }
      }
      break;
    case "learning":
      brain.learnings = brain.learnings.filter((e) => e.id !== id);
      break;
    case "preference":
      brain.preferences = brain.preferences.filter((e) => e.id !== id);
      break;
    case "context":
      brain.contexts = brain.contexts.filter((e) => e.id !== id);
      break;
    case "task":
      brain.tasks = brain.tasks.filter((e) => e.id !== id);
      break;
    case "reminder":
      brain.reminders = brain.reminders.filter((e) => e.id !== id);
      break;
    case "meta":
      for (const [k, v] of brain.meta) {
        if (v.id === id) { brain.meta.delete(k); break; }
      }
      break;
  }
}

// ── appendBrainEntry ──────────────────────────────────────────────

export async function appendBrainEntry(
  filePath: string,
  entry: BrainEntry,
): Promise<void> {
  const v = validateEntry(entry);
  if (!v.ok) {
    throw new Error(`Invalid brain entry: ${v.error}`);
  }

  const lockPath = filePath + ".lock";
  const dir = path.dirname(filePath);

  await withFileLock(lockPath, { purpose: "append" }, async () => {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(
      filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY,
      0o644,
    );
    try {
      fs.writeSync(fd, JSON.stringify(entry) + "\n");
    } finally {
      fs.closeSync(fd);
    }
  });
}

// ── appendBrainEntryWithDedup ─────────────────────────────────────

export async function appendBrainEntryWithDedup(
  filePath: string,
  entry: BrainEntry,
  isDuplicate: (existing: BrainEntry[], candidate: BrainEntry) => boolean,
): Promise<boolean> {
  const v = validateEntry(entry);
  if (!v.ok) {
    throw new Error(`Invalid brain entry: ${v.error}`);
  }

  const lockPath = filePath + ".lock";
  const dir = path.dirname(filePath);

  return await withFileLock(lockPath, { purpose: "dedup-append" }, async () => {
    fs.mkdirSync(dir, { recursive: true });

    // Read + fold current state inside the lock
    const { entries } = readBrain(filePath);
    const brain = foldBrain(entries);

    // Collect all non-tombstoned entries from materialized state
    const allEntries: BrainEntry[] = [
      ...brain.behaviors,
      ...brain.identity.values(),
      ...brain.user.values(),
      ...brain.learnings,
      ...brain.preferences,
      ...brain.contexts,
      ...brain.tasks,
      ...brain.reminders,
      ...brain.meta.values(),
    ];

    if (isDuplicate(allEntries, entry)) {
      return false;
    }

    // Append
    const fd = fs.openSync(
      filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY,
      0o644,
    );
    try {
      fs.writeSync(fd, JSON.stringify(entry) + "\n");
    } finally {
      fs.closeSync(fd);
    }

    return true;
  });
}
