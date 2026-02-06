/**
 * Brain Extension - JSONL-based persistent memory for agents
 *
 * Structure (under ~/.rho/brain/):
 *   core.jsonl     - identity, behavior, user (rarely changes)
 *   memory.jsonl   - learnings, preferences (grows, has lifecycle)
 *   context.jsonl  - project contexts (matched by cwd)
 *   archive.jsonl  - decayed entries
 *   memory/YYYY-MM-DD.md - daily markdown memory log
 *
 * Migrated from ~/.pi/brain/ automatically on first load.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { StringEnum, complete } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { brainDir, configFile } from "./workspace.ts";

// Paths — Rho owns ~/.rho/, pi owns ~/.pi/
// Brain data lives under ~/.rho/brain/ (migrated from ~/.pi/brain/)
const BRAIN_DIR = brainDir();
const LEGACY_BRAIN_DIR = path.join(os.homedir(), ".pi", "brain");
const CORE_FILE = path.join(BRAIN_DIR, "core.jsonl");
const MEMORY_FILE = path.join(BRAIN_DIR, "memory.jsonl");
const CONTEXT_FILE = path.join(BRAIN_DIR, "context.jsonl");
const ARCHIVE_FILE = path.join(BRAIN_DIR, "archive.jsonl");
const DAILY_MEMORY_DIR = path.join(BRAIN_DIR, "memory");

// Auto-memory config
// - Disabled for subagent/heartbeat sessions (RHO_SUBAGENT=1)
// - Can be overridden via env var RHO_AUTO_MEMORY=0|1
// - Persisted toggle via ~/.rho/config.json { "autoMemory": true|false }
const RHO_CONFIG_PATH = configFile();

type RhoConfig = {
  autoMemory?: boolean;
};

function readRhoConfig(): RhoConfig {
  try {
    if (!fs.existsSync(RHO_CONFIG_PATH)) return {};
    const raw = fs.readFileSync(RHO_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      // Accept both camelCase and snake_case for safety
      const autoMemory =
        typeof obj.autoMemory === "boolean"
          ? (obj.autoMemory as boolean)
          : typeof obj.auto_memory === "boolean"
            ? (obj.auto_memory as boolean)
            : undefined;
      return { autoMemory };
    }
  } catch {
    // ignore
  }
  return {};
}

function isAutoMemoryEnabled(): boolean {
  if (process.env.RHO_SUBAGENT === "1") return false;

  const env = (process.env.RHO_AUTO_MEMORY || "").trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off") return false;
  if (env === "1" || env === "true" || env === "on") return true;

  const cfg = readRhoConfig();
  if (typeof cfg.autoMemory === "boolean") return cfg.autoMemory;

  // Default: enabled
  return true;
}

const AUTO_MEMORY_DEBUG = process.env.RHO_AUTO_MEMORY_DEBUG === "1" || process.env.RHO_AUTO_MEMORY_DEBUG === "true";
const AUTO_MEMORY_MAX_ITEMS = 3;
const AUTO_MEMORY_MAX_TEXT = 200;
const AUTO_MEMORY_DEFAULT_CATEGORY = "General";
const AUTO_MEMORY_ALLOWED_CATEGORIES = new Set(["Communication", "Code", "Tools", "Workflow", "General"]);

// Feature flags
const DAILY_MEMORY_ENABLED = process.env.RHO_DAILY_MEMORY !== "0";
const COMPACT_MEMORY_FLUSH_ENABLED = process.env.RHO_COMPACT_MEMORY_FLUSH !== "0";

/**
 * Resolve the cheapest model from the same provider as the current session model.
 * Picks the model with the lowest output cost that has auth configured.
 * Falls back to ctx.model if nothing cheaper is found.
 */
async function resolveSmallModel(
  ctx: ExtensionContext
): Promise<{ model: Model<Api>; apiKey: string } | null> {
  const currentModel = ctx.model;
  if (!currentModel) return null;

  const currentApiKey = await ctx.modelRegistry.getApiKey(currentModel);
  if (!currentApiKey) return null;

  // Get all available models from the same provider, sorted by output cost
  const sameProvider = ctx.modelRegistry
    .getAll()
    .filter((m) => m.provider === currentModel.provider)
    .sort((a, b) => a.cost.output - b.cost.output);

  // Return candidates in order of preference (cheapest first, current model last).
  // Caller should try each and fall back on auth errors (e.g. OAuth not supported on older models).
  for (const candidate of sameProvider) {
    const apiKey = await ctx.modelRegistry.getApiKey(candidate);
    if (apiKey) {
      return { model: candidate, apiKey };
    }
  }

  // Fallback: use the current model as-is
  return { model: currentModel, apiKey: currentApiKey };
}

// Types
interface BaseEntry {
  id: string;
  type: string;
  created: string;
}

interface IdentityEntry extends BaseEntry {
  type: "identity";
  key: string;
  value: string;
}

interface BehaviorEntry extends BaseEntry {
  type: "behavior";
  category: "do" | "dont" | "value";
  text: string;
}

interface UserEntry extends BaseEntry {
  type: "user";
  key: string;
  value: string;
}

interface LearningEntry extends BaseEntry {
  type: "learning";
  text: string;
  used: number;
  last_used: string;
  source?: string; // what triggered this learning
}

interface PreferenceEntry extends BaseEntry {
  type: "preference";
  category: string;
  text: string;
}

interface ContextEntry extends BaseEntry {
  type: "context";
  project: string;
  path: string;
  content: string;
}

type Entry = IdentityEntry | BehaviorEntry | UserEntry | LearningEntry | PreferenceEntry | ContextEntry;

// Helpers
function nanoid(size = 8): string {
  return crypto.randomBytes(size).toString("base64url").slice(0, size);
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function ensureDir(): void {
  if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
  }
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf-8");
  const entries: T[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch (error) {
      if (AUTO_MEMORY_DEBUG) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Brain readJsonl skipped malformed line in ${file}: ${message}`);
      }
    }
  }
  return entries;
}

function appendJsonl<T>(file: string, entry: T): void {
  ensureDir();
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
}

function writeJsonl<T>(file: string, entries: T[]): void {
  ensureDir();
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
}

function ensureDailyDir(): void {
  if (!fs.existsSync(DAILY_MEMORY_DIR)) {
    fs.mkdirSync(DAILY_MEMORY_DIR, { recursive: true });
  }
}

function dailyMemoryPath(date = today()): string {
  return path.join(DAILY_MEMORY_DIR, `${date}.md`);
}

function appendDailyMemoryEntry(entry: LearningEntry | PreferenceEntry): void {
  if (!DAILY_MEMORY_ENABLED) return;
  ensureDailyDir();
  const date = entry.created || today();
  const file = dailyMemoryPath(date);
  const needsHeader = !fs.existsSync(file);
  const label =
    entry.type === "learning" ? "Learning" : `Preference (${(entry as PreferenceEntry).category})`;
  const header = needsHeader ? `# Memory ${date}\n\n` : "";
  fs.appendFileSync(file, `${header}- **${label}:** ${entry.text}\n`);
}

type StoreResult = { stored: boolean; id?: string; reason?: "empty" | "duplicate" | "too_long" };

type AutoMemoryResponse = {
  learnings?: Array<{ text?: string }>;
  preferences?: Array<{ text?: string; category?: string }>;
};

function normalizeMemoryText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function sanitizeCategory(category?: string): string {
  if (!category) return AUTO_MEMORY_DEFAULT_CATEGORY;
  const trimmed = category.trim();
  if (!trimmed) return AUTO_MEMORY_DEFAULT_CATEGORY;
  for (const allowed of AUTO_MEMORY_ALLOWED_CATEGORIES) {
    if (allowed.toLowerCase() === trimmed.toLowerCase()) return allowed;
  }
  return AUTO_MEMORY_DEFAULT_CATEGORY;
}

function isDuplicateLearning(existing: Entry[], text: string): boolean {
  const normalized = normalizeMemoryText(text).toLowerCase();
  return existing.some(
    (e) => e.type === "learning" && normalizeMemoryText((e as LearningEntry).text).toLowerCase() === normalized
  );
}

function isDuplicatePreference(existing: Entry[], text: string, category: string): boolean {
  const normalized = normalizeMemoryText(text).toLowerCase();
  return existing.some(
    (e) =>
      e.type === "preference" &&
      normalizeMemoryText((e as PreferenceEntry).text).toLowerCase() === normalized &&
      (e as PreferenceEntry).category === category
  );
}

function storeLearningEntry(text: string, options?: { source?: string; maxLength?: number }): StoreResult {
  const normalized = normalizeMemoryText(text);
  if (!normalized) return { stored: false, reason: "empty" };
  if (options?.maxLength && normalized.length > options.maxLength) {
    return { stored: false, reason: "too_long" };
  }
  const existing = readJsonl<Entry>(MEMORY_FILE);
  if (isDuplicateLearning(existing, normalized)) {
    return { stored: false, reason: "duplicate" };
  }
  const entry: LearningEntry = {
    id: nanoid(),
    type: "learning",
    text: normalized,
    used: 0,
    last_used: today(),
    created: today(),
    source: options?.source,
  };
  appendJsonl(MEMORY_FILE, entry);
  appendDailyMemoryEntry(entry);
  return { stored: true, id: entry.id };
}

function storePreferenceEntry(
  text: string,
  category: string,
  options?: { maxLength?: number }
): StoreResult {
  const normalized = normalizeMemoryText(text);
  if (!normalized) return { stored: false, reason: "empty" };
  if (options?.maxLength && normalized.length > options.maxLength) {
    return { stored: false, reason: "too_long" };
  }
  const normalizedCategory = sanitizeCategory(category);
  const existing = readJsonl<Entry>(MEMORY_FILE);
  if (isDuplicatePreference(existing, normalized, normalizedCategory)) {
    return { stored: false, reason: "duplicate" };
  }
  const entry: PreferenceEntry = {
    id: nanoid(),
    type: "preference",
    category: normalizedCategory,
    text: normalized,
    created: today(),
  };
  appendJsonl(MEMORY_FILE, entry);
  appendDailyMemoryEntry(entry);
  return { stored: true, id: entry.id };
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseAutoMemoryResponse(text: string): AutoMemoryResponse | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as AutoMemoryResponse;
  } catch {
    return null;
  }
}

function formatExistingMemories(entries: Entry[]): string {
  const learnings = entries.filter((e): e is LearningEntry => e.type === "learning");
  const preferences = entries.filter((e): e is PreferenceEntry => e.type === "preference");
  const lines: string[] = [];
  for (const l of learnings) lines.push(`- ${l.text}`);
  for (const p of preferences) lines.push(`- [${p.category}] ${p.text}`);
  return lines.join("\n");
}

function buildAutoMemoryPrompt(conversationText: string, existingMemories?: string): string {
  const parts = [
    "You are a memory extraction system for a personal assistant.",
    "Extract durable learnings and user preferences that will remain useful across sessions.",
    "Only include stable facts or clear preferences. Skip one-off tasks, transient requests, and generic facts.",
    "Keep each entry concise (under 120 characters).",
  ];

  if (existingMemories) {
    parts.push(
      "",
      "IMPORTANT: These memories are already stored. Do NOT extract anything that restates, overlaps with, or is a subset of these:",
      "<existing_memories>",
      existingMemories,
      "</existing_memories>",
      "",
      "Only extract genuinely NEW information not covered above."
    );
  }

  parts.push(
    "Output strict JSON only with this shape:",
    '{"learnings":[{"text":"..."}],"preferences":[{"category":"Communication|Code|Tools|Workflow|General","text":"..."}]}',
    "If there are no NEW items to add, return {\"learnings\":[],\"preferences\":[]}.",
    "",
    "<conversation>",
    conversationText,
    "</conversation>"
  );

  return parts.join("\n");
}

async function runAutoMemoryExtraction(
  messages: AgentMessage[],
  ctx: ExtensionContext,
  options?: { source?: string; signal?: AbortSignal; maxItems?: number; maxText?: number }
): Promise<{ storedLearnings: number; storedPrefs: number } | null> {
  if (!isAutoMemoryEnabled()) return null;

  const resolved = await resolveSmallModel(ctx);
  if (!resolved) return null;
  const { model } = resolved;

  const conversationText = serializeConversation(convertToLlm(messages));
  if (!conversationText.trim()) return null;

  if (AUTO_MEMORY_DEBUG && ctx.hasUI) {
    ctx.ui.notify(`Auto-memory: extracting via ${model.name}...`, "info");
  }

  // Feed existing memories so the LLM avoids duplicates
  const existing = readJsonl<Entry>(MEMORY_FILE);
  const existingText = existing.length > 0 ? formatExistingMemories(existing) : undefined;

  const prompt = buildAutoMemoryPrompt(conversationText, existingText);

  // Try resolved model first, fall back to current session model if needed.
  let response;
  const candidates = [resolved];
  if (resolved.model.id !== ctx.model?.id && ctx.model) {
    const fallbackKey = await ctx.modelRegistry.getApiKey(ctx.model);
    if (fallbackKey) candidates.push({ model: ctx.model, apiKey: fallbackKey });
  }

  for (const { model, apiKey } of candidates) {
    try {
      const maxTokens = Math.min(512, model.maxTokens || 512);
      const result = await complete(
        model,
        {
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        { apiKey, maxTokens, signal: options?.signal }
      );
      // complete() doesn't throw on API errors — check stopReason
      if (result.stopReason === "error") {
        if (AUTO_MEMORY_DEBUG) {
          console.error(`Auto-memory error from ${model.id}: ${result.errorMessage}`);
        }
        continue;
      }
      response = result;
      break;
    } catch (e) {
      if (AUTO_MEMORY_DEBUG) {
        console.error(`Auto-memory failed with ${model.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (!response) return null;

  const responseText = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  const parsed = parseAutoMemoryResponse(responseText);
  if (!parsed) {
    if (AUTO_MEMORY_DEBUG && ctx.hasUI) {
      ctx.ui.notify("Auto-memory: no JSON response", "warning");
    }
    return null;
  }

  const learnings = (parsed.learnings ?? [])
    .map((l) => normalizeMemoryText(l.text ?? ""))
    .filter(Boolean);
  const preferences = (parsed.preferences ?? [])
    .map((p) => ({
      text: normalizeMemoryText(p.text ?? ""),
      category: sanitizeCategory(p.category),
    }))
    .filter((p) => p.text.length > 0);

  const maxItems = options?.maxItems ?? AUTO_MEMORY_MAX_ITEMS;
  const maxText = options?.maxText ?? AUTO_MEMORY_MAX_TEXT;
  const source = options?.source ?? "auto";
  let remaining = maxItems;
  let storedLearnings = 0;
  let storedPrefs = 0;

  for (const text of learnings) {
    if (remaining <= 0) break;
    const result = storeLearningEntry(text, { source, maxLength: maxText });
    if (result.stored) {
      storedLearnings += 1;
      remaining -= 1;
    }
  }

  for (const pref of preferences) {
    if (remaining <= 0) break;
    const result = storePreferenceEntry(pref.text, pref.category, { maxLength: maxText });
    if (result.stored) {
      storedPrefs += 1;
      remaining -= 1;
    }
  }

  if ((storedLearnings > 0 || storedPrefs > 0) && ctx.hasUI) {
    ctx.ui.notify(`Auto-memory stored: ${storedLearnings}L ${storedPrefs}P`, "info");
  }

  return { storedLearnings, storedPrefs };
}

// ── Memory consolidation (hybrid: deterministic dedup + LLM semantic pass) ──

// Phase 1: Deterministic dedup using word-overlap similarity (Jaccard)
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s/._-]/g, "").split(/\s+/).filter(w => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const JACCARD_THRESHOLD = 0.6;
const CONTAINMENT_THRESHOLD = 0.8; // If 80%+ of A's tokens are in B, A is redundant

function containmentRatio(smaller: Set<string>, larger: Set<string>): number {
  if (smaller.size === 0) return 1;
  let contained = 0;
  for (const w of smaller) { if (larger.has(w)) contained++; }
  return contained / smaller.size;
}

function deterministicDedup(entries: Entry[]): { kept: Entry[]; removed: Entry[] } {
  const learnings = entries.filter((e): e is LearningEntry => e.type === "learning");
  const preferences = entries.filter((e): e is PreferenceEntry => e.type === "preference");
  const others = entries.filter(e => e.type !== "learning" && e.type !== "preference");

  function dedupGroup<T extends LearningEntry | PreferenceEntry>(
    items: T[],
    getText: (e: T) => string
  ): { kept: T[]; removed: T[] } {
    const tokenized = items.map(e => ({ entry: e, tokens: tokenize(getText(e)), len: getText(e).length }));
    const removed = new Set<string>();

    // Pass 1: Jaccard similarity clustering
    const clusters: T[][] = [];
    for (let i = 0; i < tokenized.length; i++) {
      if (removed.has(tokenized[i].entry.id)) continue;
      const cluster: T[] = [tokenized[i].entry];
      for (let j = i + 1; j < tokenized.length; j++) {
        if (removed.has(tokenized[j].entry.id)) continue;
        if (jaccardSimilarity(tokenized[i].tokens, tokenized[j].tokens) >= JACCARD_THRESHOLD) {
          cluster.push(tokenized[j].entry);
          removed.add(tokenized[j].entry.id);
        }
      }
      clusters.push(cluster);
    }

    // From each cluster, keep the longest entry
    const keptAfterJaccard: T[] = [];
    const removedEntries: T[] = [];
    for (const cluster of clusters) {
      const sorted = cluster.sort((a, b) => getText(b).length - getText(a).length);
      keptAfterJaccard.push(sorted[0]);
      removedEntries.push(...sorted.slice(1));
    }

    // Pass 2: Containment check -- if a shorter entry's tokens are mostly in a longer one, remove it
    const keptTokenized = keptAfterJaccard.map(e => ({ entry: e, tokens: tokenize(getText(e)), len: getText(e).length }));
    const containmentRemoved = new Set<string>();
    for (let i = 0; i < keptTokenized.length; i++) {
      if (containmentRemoved.has(keptTokenized[i].entry.id)) continue;
      for (let j = 0; j < keptTokenized.length; j++) {
        if (i === j || containmentRemoved.has(keptTokenized[j].entry.id)) continue;
        // Check if j is contained in i (j is shorter, i is longer)
        if (keptTokenized[j].len < keptTokenized[i].len) {
          if (containmentRatio(keptTokenized[j].tokens, keptTokenized[i].tokens) >= CONTAINMENT_THRESHOLD) {
            containmentRemoved.add(keptTokenized[j].entry.id);
          }
        }
      }
    }

    const finalKept = keptAfterJaccard.filter(e => !containmentRemoved.has(e.id));
    const containmentRemovedEntries = keptAfterJaccard.filter(e => containmentRemoved.has(e.id));

    return { kept: finalKept, removed: [...removedEntries, ...containmentRemovedEntries] };
  }

  const dedupedLearnings = dedupGroup(learnings, e => e.text);
  const dedupedPreferences = dedupGroup(preferences, e => e.text);

  return {
    kept: [...others, ...dedupedLearnings.kept, ...dedupedPreferences.kept],
    removed: [...dedupedLearnings.removed, ...dedupedPreferences.removed],
  };
}

// Phase 2: LLM semantic pass — ask for IDs to remove + rewrites (small output)
type SemanticResponse = {
  remove: string[];
  rewrite: Array<{ id: string; text: string }>;
};

function buildSemanticPrompt(entries: Entry[]): string {
  const learnings = entries.filter((e): e is LearningEntry => e.type === "learning");
  const preferences = entries.filter((e): e is PreferenceEntry => e.type === "preference");

  let entriesText = "LEARNINGS:\n";
  for (const l of learnings) entriesText += `[${l.id}] ${l.text}\n`;
  entriesText += "\nPREFERENCES:\n";
  for (const p of preferences) entriesText += `[${p.id}] [${p.category}] ${p.text}\n`;

  return [
    "You are a memory consolidation system. Review these entries and identify IDs to REMOVE.",
    "",
    "ONLY remove entries that are clearly one of:",
    "1. SEMANTIC DUPLICATES: nearly identical meaning to another entry (keep the longer one, remove the shorter)",
    "2. SUPERSEDED: directly contradicted by a newer entry about the same specific topic",
    "",
    "KEEP everything else. When in doubt, KEEP. Be very conservative.",
    "Do NOT remove: environment setup, API details, config paths, tool usage patterns, architecture facts, user preferences.",
    "Do NOT remove entries just because they seem old or specific -- specificity is valuable.",
    "",
    "Also identify entries to REWRITE: where 2 entries about the exact same topic should merge (use the surviving entry's ID).",
    "",
    entriesText,
    "",
    "IMPORTANT: Output ONLY a JSON object with two keys: 'remove' (array of IDs to delete) and 'rewrite' (array of {id, text} to update).",
    "Do NOT return all entries. Do NOT echo back entries you want to keep. ONLY list changes.",
    "No markdown, no code fences, no explanation. Raw JSON only.",
    "Example: {\"remove\":[\"abc\",\"def\"],\"rewrite\":[{\"id\":\"ghi\",\"text\":\"merged text\"}]}",
  ].join("\n");
}

function parseSemanticResponse(text: string): SemanticResponse | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.remove)) return null;
    if (!Array.isArray(parsed.rewrite)) return null;
    return parsed as SemanticResponse;
  } catch {
    return null;
  }
}

async function runConsolidation(
  ctx: ExtensionContext,
  options?: { signal?: AbortSignal; dryRun?: boolean }
): Promise<{ before: number; after: number; removed: number; error?: string } | null> {
  const entries = readJsonl<Entry>(MEMORY_FILE);
  if (entries.length < 5) return { before: entries.length, after: entries.length, removed: 0, error: "too few entries (< 5)" };

  // ── Phase 1: Deterministic dedup (instant, no LLM) ──
  const { kept: phase1Kept, removed: phase1Removed } = deterministicDedup(entries);
  const phase1Count = phase1Removed.length;

  // ── Phase 2: LLM semantic pass (small output: just IDs + rewrites) ──
  let phase2Removes: string[] = [];
  let phase2Rewrites: SemanticResponse["rewrite"] = [];
  let llmError: string | undefined;

  const resolved = await resolveSmallModel(ctx);
  if (resolved && phase1Kept.length > 5) {
    const candidates = [resolved];
    if (resolved.model.id !== ctx.model?.id && ctx.model) {
      const fallbackKey = await ctx.modelRegistry.getApiKey(ctx.model);
      if (fallbackKey) candidates.push({ model: ctx.model, apiKey: fallbackKey });
    }

    const prompt = buildSemanticPrompt(phase1Kept);
    let semantic: SemanticResponse | null = null;

    for (const { model, apiKey } of candidates) {
      if (options?.signal?.aborted) break;
      try {
        const maxTokens = Math.min(4096, model.maxTokens || 4096);
        const result = await complete(
          model,
          {
            messages: [
              { role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() },
              { role: "assistant" as const, content: [{ type: "text" as const, text: '{"remove":[' }], timestamp: Date.now() },
            ],
          },
          { apiKey, maxTokens, signal: options?.signal }
        );
        if (result.stopReason === "error") {
          llmError = `${model.id}: ${result.errorMessage || "error"}`;
          continue;
        }
        const responseText = result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text).join("\n").trim();
        semantic = parseSemanticResponse('{"remove":[' + responseText);
        if (semantic) break;
        llmError = `${model.id}: JSON parse failed`;
      } catch (e) {
        llmError = `${model.id}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (semantic) {
      // Cap phase 2 removals at 15% of entries to prevent LLM over-pruning
      const maxRemoves = Math.max(5, Math.floor(phase1Kept.length * 0.15));
      phase2Removes = semantic.remove.slice(0, maxRemoves);
      phase2Rewrites = semantic.rewrite.slice(0, 20);
    }
  }

  // ── Apply results ──
  const removeSet = new Set(phase2Removes);
  const rewriteMap = new Map(phase2Rewrites.map(r => [r.id, r.text]));

  // Build final entry list from phase1 survivors, applying phase2 removes + rewrites
  const newEntries: Entry[] = [];
  for (const entry of phase1Kept) {
    if (removeSet.has(entry.id)) continue;
    const rewrite = rewriteMap.get(entry.id);
    if (rewrite) {
      const normalized = normalizeMemoryText(rewrite);
      if (entry.type === "learning") {
        newEntries.push({ ...entry, text: normalized, last_used: today() } as LearningEntry);
      } else if (entry.type === "preference") {
        newEntries.push({ ...entry, text: normalized } as PreferenceEntry);
      } else {
        newEntries.push(entry);
      }
    } else {
      newEntries.push(entry);
    }
  }

  const before = entries.length;
  const after = newEntries.length;
  const totalRemoved = before - after;

  if (options?.dryRun) {
    return { before, after, removed: totalRemoved, error: llmError ? `phase2: ${llmError}` : undefined };
  }

  // Safety: don't write if consolidation removed more than 40%
  if (after < before * 0.6) {
    return { before, after, removed: totalRemoved, error: `too aggressive: ${after}/${before} kept (${Math.round(after/before*100)}%), need > 60%` };
  }

  // Archive removed entries
  const keptIds = new Set(newEntries.map(e => e.id));
  const allRemoved = entries.filter(e => !keptIds.has(e.id));
  if (allRemoved.length > 0) {
    ensureDir();
    for (const r of allRemoved) {
      appendJsonl(ARCHIVE_FILE, { ...r, archived: today(), reason: "consolidation" });
    }
  }

  writeJsonl(MEMORY_FILE, newEntries);

  const parts = [`phase1 dedup: -${phase1Count}`];
  if (phase2Removes.length > 0 || phase2Rewrites.length > 0) {
    parts.push(`phase2 llm: -${phase2Removes.length} removed, ${phase2Rewrites.length} rewritten`);
  }
  if (llmError) parts.push(`(phase2 warning: ${llmError})`);

  return { before, after, removed: totalRemoved, error: llmError ? parts.join("; ") : undefined };
}

// Migrate from legacy ~/.pi/brain/ to ~/.rho/brain/
function migrateLegacyBrain(): void {
  if (!fs.existsSync(LEGACY_BRAIN_DIR)) return;
  if (fs.existsSync(BRAIN_DIR) && fs.readdirSync(BRAIN_DIR).length > 0) return; // already migrated

  ensureDir();

  // Copy all files from legacy dir
  for (const entry of fs.readdirSync(LEGACY_BRAIN_DIR, { withFileTypes: true })) {
    const src = path.join(LEGACY_BRAIN_DIR, entry.name);
    const dst = path.join(BRAIN_DIR, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
      for (const sub of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, sub), path.join(dst, sub));
      }
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  if (AUTO_MEMORY_DEBUG) {
    console.error(`Brain migrated: ${LEGACY_BRAIN_DIR} -> ${BRAIN_DIR}`);
  }
}

// Bootstrap from defaults
function bootstrapDefaults(extensionDir: string): void {
  const defaultsDir = path.join(path.dirname(extensionDir), "brain");
  if (!fs.existsSync(defaultsDir)) return;

  ensureDir();
  for (const file of fs.readdirSync(defaultsDir)) {
    if (!file.endsWith(".jsonl.default")) continue;
    const target = path.join(BRAIN_DIR, file.replace(".default", ""));
    if (!fs.existsSync(target)) {
      fs.copyFileSync(path.join(defaultsDir, file), target);
    }
  }
}

// Build context for system prompt
function buildBrainContext(cwd: string): string {
  const sections: string[] = [];

  // Core entries
  const core = readJsonl<Entry>(CORE_FILE);

  // Identity
  const identity = core.filter((e): e is IdentityEntry => e.type === "identity");
  if (identity.length > 0) {
    sections.push("## Identity\n" + identity.map((e) => `- ${e.key}: ${e.value}`).join("\n"));
  }

  // User
  const user = core.filter((e): e is UserEntry => e.type === "user");
  if (user.length > 0) {
    sections.push("## User\n" + user.map((e) => `- ${e.key}: ${e.value}`).join("\n"));
  }

  // Behavior - compact format
  const behaviors = core.filter((e): e is BehaviorEntry => e.type === "behavior");
  if (behaviors.length > 0) {
    const dos = behaviors.filter((b) => b.category === "do").map((b) => b.text);
    const donts = behaviors.filter((b) => b.category === "dont").map((b) => b.text);
    const values = behaviors.filter((b) => b.category === "value").map((b) => b.text);

    let behaviorSection = "## Behavior\n";
    if (dos.length > 0) behaviorSection += `**Do:** ${dos.join(". ")}.\n`;
    if (donts.length > 0) behaviorSection += `**Don't:** ${donts.join(". ")}.\n`;
    if (values.length > 0) behaviorSection += `**Values:** ${values.join(". ")}.`;
    sections.push(behaviorSection.trim());
  }

  // Memory (learnings + preferences) - only if non-empty
  const memory = readJsonl<Entry>(MEMORY_FILE);
  const learnings = memory.filter((e): e is LearningEntry => e.type === "learning");
  const preferences = memory.filter((e): e is PreferenceEntry => e.type === "preference");

  if (learnings.length > 0) {
    // Sort by usage (most used first), then by recency
    const sorted = [...learnings].sort((a, b) => {
      if (b.used !== a.used) return b.used - a.used;
      return b.last_used.localeCompare(a.last_used);
    });
    sections.push("## Learnings\n" + sorted.map((l) => `- ${l.text}`).join("\n"));
  }

  if (preferences.length > 0) {
    const byCategory = new Map<string, string[]>();
    for (const p of preferences) {
      const list = byCategory.get(p.category) || [];
      list.push(p.text);
      byCategory.set(p.category, list);
    }
    let prefSection = "## Preferences\n";
    for (const [cat, items] of byCategory) {
      prefSection += `**${cat}:** ${items.join(". ")}.\n`;
    }
    sections.push(prefSection.trim());
  }

  // Context (matched by cwd)
  const contexts = readJsonl<ContextEntry>(CONTEXT_FILE);
  const matched = contexts.find((c) => cwd.startsWith(c.path));
  if (matched) {
    sections.push(`## Project: ${matched.project}\n\n${matched.content}`);
  }

  return sections.join("\n\n");
}

// Concise memory instructions with examples
const MEMORY_INSTRUCTIONS = `## Memory

You have persistent memory via the \`memory\` tool. Store insights that help future sessions.

**Store when:**
- User corrects you → learning
- You discover a pattern/convention → learning  
- User states a preference → preference with category

**Good learnings:** "User prefers early returns over nested ifs", "This repo uses pnpm not npm", "API uses snake_case"
**Bad learnings:** "User asked about X", "Fixed a bug", "Session went well"

**Don't store:** obvious things, duplicates, session-specific details.`.trim();

export default function (pi: ExtensionAPI) {
  // Bootstrap on load — migrate from legacy location if needed
  migrateLegacyBrain();
  bootstrapDefaults(__dirname);

  let autoMemoryInFlight = false;
  let compactMemoryInFlight = false;

  // Cache brain context at session start (stable for the session) and update widget
  let cachedBrainPrompt: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    const brainContext = buildBrainContext(ctx.cwd);
    cachedBrainPrompt = brainContext.trim()
      ? "\n\n# Memory\n\n" + MEMORY_INSTRUCTIONS + "\n\n" + brainContext
      : null;
    updateBrainWidget(ctx);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    if (cachedBrainPrompt) {
      return { systemPrompt: event.systemPrompt + cachedBrainPrompt };
    }
  });

  // LLM-based auto-memory extraction
  pi.on("agent_end", async (event, ctx) => {
    if (!isAutoMemoryEnabled() || autoMemoryInFlight) return;
    autoMemoryInFlight = true;
    try {
      const result = await runAutoMemoryExtraction(event.messages, ctx, { source: "auto" });
      if (result && (result.storedLearnings > 0 || result.storedPrefs > 0)) {
        updateBrainWidget(ctx);
      }
    } catch (error) {
      if (AUTO_MEMORY_DEBUG && ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Auto-memory error: ${message}`, "error");
      }
    } finally {
      autoMemoryInFlight = false;
    }
  });

  // Pre-compaction memory flush
  pi.on("session_before_compact", async (event, ctx) => {
    if (!isAutoMemoryEnabled() || !COMPACT_MEMORY_FLUSH_ENABLED || compactMemoryInFlight) return;
    if (event.signal.aborted) return;

    const messages = Array.from(
      new Set([...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages])
    );
    if (messages.length === 0) return;

    compactMemoryInFlight = true;
    try {
      if (AUTO_MEMORY_DEBUG && ctx.hasUI) {
        ctx.ui.notify("Auto-memory: flushing before compaction...", "info");
      }
      const result = await runAutoMemoryExtraction(messages, ctx, {
        source: "compaction",
        signal: event.signal,
      });
      if (result && (result.storedLearnings > 0 || result.storedPrefs > 0)) {
        updateBrainWidget(ctx);
      }
    } catch (error) {
      if (AUTO_MEMORY_DEBUG && ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Auto-memory error: ${message}`, "error");
      }
    } finally {
      compactMemoryInFlight = false;
    }
  });

  // Helper to update brain widget
  function updateBrainWidget(ctx: {
    cwd?: string;
    ui?: { setStatus?: (id: string, text: string | undefined) => void };
  }) {
    if (!ctx?.ui?.setStatus) return;

    const memory = readJsonl<Entry>(MEMORY_FILE);
    const contexts = readJsonl<ContextEntry>(CONTEXT_FILE);
    const learnings = memory.filter((e) => e.type === "learning").length;
    const prefs = memory.filter((e) => e.type === "preference").length;
    const cwd = ctx.cwd ?? process.cwd();
    const matched = contexts.find((c) => cwd.startsWith(c.path));

    let status = `🧠 ${learnings}L ${prefs}P`;
    if (matched) {
      status += ` · ${matched.project}`;
    }
    ctx.ui.setStatus("brain", status);
  }

  // Register memory tool with clear, specific description
  pi.registerTool({
    name: "memory",
    label: "Memory",
    description:
      "Store learnings (corrections, patterns, conventions) or preferences (user likes/dislikes with category). Use after user corrections or when discovering something future sessions need. Actions: add_learning, add_preference, reinforce, search, list, consolidate.",
    parameters: Type.Object({
      action: StringEnum(["add_learning", "add_preference", "reinforce", "search", "list", "consolidate"] as const),
      content: Type.Optional(Type.String({ description: "Concise, actionable text" })),
      category: Type.Optional(Type.String({ description: "Category: Communication, Code, Tools, Workflow, General" })),
      query: Type.Optional(Type.String({ description: "Search query" })),
      id: Type.Optional(Type.String({ description: "Entry ID for reinforce" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      switch (params.action) {
        case "add_learning": {
          if (!params.content) {
            return { content: [{ type: "text", text: "Error: content required" }], details: { error: true } };
          }
          const result = storeLearningEntry(params.content);
          if (!result.stored) {
            const message = result.reason === "duplicate" ? "Already stored" : "Not stored";
            return {
              content: [{ type: "text", text: message }],
              details: { duplicate: result.reason === "duplicate" },
            };
          }
          updateBrainWidget(ctx);
          return {
            content: [{ type: "text", text: `Stored: ${params.content}` }],
            details: { id: result.id },
          };
        }

        case "add_preference": {
          if (!params.content) {
            return { content: [{ type: "text", text: "Error: content required" }], details: { error: true } };
          }
          const category = sanitizeCategory(params.category);
          const result = storePreferenceEntry(params.content, category);
          if (!result.stored) {
            const message = result.reason === "duplicate" ? "Already stored" : "Not stored";
            return {
              content: [{ type: "text", text: message }],
              details: { duplicate: result.reason === "duplicate" },
            };
          }
          updateBrainWidget(ctx);
          return {
            content: [{ type: "text", text: `Stored [${category}]: ${params.content}` }],
            details: { id: result.id },
          };
        }

        case "reinforce": {
          if (!params.id) {
            return { content: [{ type: "text", text: "Error: id required" }], details: { error: true } };
          }
          const entries = readJsonl<Entry>(MEMORY_FILE);
          const idx = entries.findIndex((e) => e.id === params.id);
          if (idx === -1) {
            return { content: [{ type: "text", text: "Entry not found" }], details: { error: true } };
          }
          const entry = entries[idx];
          if (entry.type === "learning") {
            (entry as LearningEntry).used++;
            (entry as LearningEntry).last_used = today();
          }
          writeJsonl(MEMORY_FILE, entries);
          return {
            content: [{ type: "text", text: `Reinforced: ${(entry as LearningEntry).text}` }],
            details: { id: entry.id, used: (entry as LearningEntry).used },
          };
        }

        case "search": {
          const query = (params.query || "").toLowerCase();
          const memory = readJsonl<Entry>(MEMORY_FILE);
          const matches = memory.filter((e) => {
            if (e.type === "learning") return (e as LearningEntry).text.toLowerCase().includes(query);
            if (e.type === "preference") return (e as PreferenceEntry).text.toLowerCase().includes(query);
            return false;
          });
          return {
            content: [
              {
                type: "text",
                text: matches.length
                  ? matches.map((m) => `[${m.id}] ${(m as LearningEntry | PreferenceEntry).text}`).join("\n")
                  : "No matches",
              },
            ],
            details: { count: matches.length },
          };
        }

        case "list": {
          const memory = readJsonl<Entry>(MEMORY_FILE);
          const learnings = memory.filter((e) => e.type === "learning") as LearningEntry[];
          const prefs = memory.filter((e) => e.type === "preference") as PreferenceEntry[];
          let text = `**Learnings (${learnings.length}):**\n`;
          text += learnings.map((l) => `- ${l.text}`).join("\n") || "(none)";
          text += `\n\n**Preferences (${prefs.length}):**\n`;
          text += prefs.map((p) => `- [${p.category}] ${p.text}`).join("\n") || "(none)";
          return { content: [{ type: "text", text }], details: { learnings: learnings.length, preferences: prefs.length } };
        }

        case "consolidate": {
          try {
            const result = await runConsolidation(ctx);
            if (!result) {
              return {
                content: [{ type: "text", text: "Consolidation returned null (unexpected)." }],
                details: { error: true },
              };
            }
            // If nothing was removed and there's an error, it's a real failure
            if (result.removed === 0 && result.error) {
              return {
                content: [{ type: "text", text: `Consolidation failed: ${result.error}` }],
                details: result,
              };
            }
            updateBrainWidget(ctx);
            const msg = `Consolidated: ${result.before} → ${result.after} entries (removed ${result.removed}).`;
            const warning = result.error ? ` Note: ${result.error}` : "";
            return {
              content: [{ type: "text", text: msg + warning }],
              details: result,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: `Consolidation error: ${message}` }],
              details: { error: true },
            };
          }
        }

        default:
          return { content: [{ type: "text", text: `Unknown action` }], details: { error: true } };
      }
    },
  });

  // Register /brain command
  pi.registerCommand("brain", {
    description: "View brain stats or search (usage: /brain [stats|search <query>])",
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) || [];
      const subcmd = parts[0] || "stats";

      if (subcmd === "stats" || !subcmd) {
        const core = readJsonl<Entry>(CORE_FILE);
        const memory = readJsonl<Entry>(MEMORY_FILE);
        const learnings = memory.filter((e) => e.type === "learning").length;
        const prefs = memory.filter((e) => e.type === "preference").length;
        const identity = core.filter((e) => e.type === "identity").length;
        const behaviors = core.filter((e) => e.type === "behavior").length;
        ctx.ui.notify(`🧠 ${learnings}L ${prefs}P | core: ${identity}id ${behaviors}beh`, "info");
      } else if (subcmd === "search") {
        const query = parts.slice(1).join(" ").toLowerCase();
        if (!query) {
          ctx.ui.notify("Usage: /brain search <query>", "error");
          return;
        }
        const memory = readJsonl<Entry>(MEMORY_FILE);
        const matches = memory.filter((e) => {
          if (e.type === "learning") return (e as LearningEntry).text.toLowerCase().includes(query);
          if (e.type === "preference") return (e as PreferenceEntry).text.toLowerCase().includes(query);
          return false;
        });
        ctx.ui.notify(matches.length ? `Found ${matches.length} matches` : "No matches", "info");
      } else if (subcmd === "consolidate") {
        ctx.ui.notify("🧠 Consolidating memories...", "info");
        try {
          const result = await runConsolidation(ctx);
          if (!result) {
            ctx.ui.notify("🧠 Consolidation returned null", "warning");
          } else if (result.removed === 0 && result.error) {
            ctx.ui.notify(`🧠 Failed: ${result.error}`, "warning");
          } else {
            ctx.ui.notify(
              `🧠 ${result.before} → ${result.after} (removed ${result.removed})`,
              "info"
            );
            updateBrainWidget(ctx);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`🧠 Error: ${message}`, "error");
        }
      } else {
        ctx.ui.notify("Usage: /brain [stats|search <query>|consolidate]", "error");
      }
    },
  });
}
