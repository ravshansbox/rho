/**
 * Vault Search Extension
 *
 * FTS5 full-text search over the Rho vault (~/.rho/vault/).
 * Inline incremental indexing, rg fallback, zero external dependencies.
 *
 * Tools:  vault_search
 * Commands: /vault-reindex
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { DatabaseSync } from "node:sqlite";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAULT_DIR = path.join(os.homedir(), ".rho", "vault");
const DB_PATH = path.join(VAULT_DIR, ".vault-search.db");
const SCHEMA_VERSION = "1";
const SUBDIRS = ["concepts", "references", "patterns", "projects", "log", "moc", "notes"];

// ─── Database ─────────────────────────────────────────────────────────────────

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const exists = fs.existsSync(DB_PATH);
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  ensureSchema(db);
  if (!exists) fullIndex(db);
  return db;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      title TEXT,
      type TEXT,
      tags TEXT,
      wikilinks TEXT,
      content_hash TEXT NOT NULL,
      char_count INTEGER,
      indexed_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title, body, tags,
      tokenize='porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS search_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Set schema version
  db.prepare("INSERT OR REPLACE INTO search_meta(key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

function walkVault(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".md")) files.push(full);
    }
  }
  walk(VAULT_DIR);
  return files;
}

interface ParsedNote {
  title: string;
  type: string;
  tags: string[];
  wikilinks: string[];
  body: string;
}

function parseNote(content: string): ParsedNote {
  let title = "";
  let type = "";
  let tags: string[] = [];
  let body = content;

  // Extract YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const titleM = fm.match(/title:\s*(.+)/);
    const typeM = fm.match(/type:\s*(\S+)/);
    const tagsM = fm.match(/tags:\s*\[([^\]]*)\]/);
    if (titleM) title = titleM[1].trim().replace(/^["']|["']$/g, "");
    if (typeM) type = typeM[1].trim();
    if (tagsM) tags = tagsM[1].split(",").map((t) => t.trim()).filter(Boolean);
    body = content.slice(fmMatch[0].length);
  }

  // Fall back to first heading for title
  if (!title) {
    const h1 = body.match(/^#\s+(.+)/m);
    if (h1) title = h1[1].trim();
  }

  // Extract wikilinks
  const wikilinks: string[] = [];
  const linkRe = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content)) !== null) {
    const link = m[1].split("|")[0].trim(); // handle [[slug|display]]
    if (!wikilinks.includes(link)) wikilinks.push(link);
  }

  return { title, type, tags, wikilinks, body };
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function fullIndex(db: DatabaseSync): { total: number; new: number; updated: number; deleted: number } {
  const files = walkVault();
  const now = new Date().toISOString();

  const insertDoc = db.prepare(
    "INSERT OR REPLACE INTO documents(path, title, type, tags, wikilinks, content_hash, char_count, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertFts = db.prepare("INSERT INTO documents_fts(rowid, title, body, tags) VALUES (?, ?, ?, ?)");
  const deleteFts = db.prepare("DELETE FROM documents_fts WHERE rowid = ?");
  const getDoc = db.prepare("SELECT id, content_hash FROM documents WHERE path = ?");

  // Track existing paths for deletion detection
  const existingPaths = new Set<string>();
  for (const row of db.prepare("SELECT path FROM documents").all() as { path: string }[]) {
    existingPaths.add(row.path);
  }

  let newCount = 0;
  let updatedCount = 0;
  const seenPaths = new Set<string>();

  for (const absPath of files) {
    const relPath = path.relative(VAULT_DIR, absPath);
    seenPaths.add(relPath);

    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const hash = hashContent(content);
    const existing = getDoc.get(relPath) as { id: number; content_hash: string } | undefined;

    if (existing && existing.content_hash === hash) continue; // unchanged

    const note = parseNote(content);
    const tagsJson = JSON.stringify(note.tags);
    const wikilinksJson = JSON.stringify(note.wikilinks);

    if (existing) {
      // Update: delete old FTS row, insert new
      deleteFts.run(existing.id);
      insertDoc.run(relPath, note.title, note.type, tagsJson, wikilinksJson, hash, content.length, now);
      const updated = getDoc.get(relPath) as { id: number; content_hash: string };
      insertFts.run(updated.id, note.title, note.body, note.tags.join(" "));
      updatedCount++;
    } else {
      // New file
      insertDoc.run(relPath, note.title, note.type, tagsJson, wikilinksJson, hash, content.length, now);
      const inserted = getDoc.get(relPath) as { id: number; content_hash: string };
      insertFts.run(inserted.id, note.title, note.body, note.tags.join(" "));
      newCount++;
    }
  }

  // Delete removed files
  let deletedCount = 0;
  const deleteDoc = db.prepare("DELETE FROM documents WHERE path = ?");
  for (const oldPath of existingPaths) {
    if (!seenPaths.has(oldPath)) {
      const old = getDoc.get(oldPath) as { id: number; content_hash: string } | undefined;
      if (old) {
        deleteFts.run(old.id);
        deleteDoc.run(oldPath);
        deletedCount++;
      }
    }
  }

  db.prepare("INSERT OR REPLACE INTO search_meta(key, value) VALUES ('last_full_index', ?)").run(now);

  return { total: files.length, new: newCount, updated: updatedCount, deleted: deletedCount };
}

// ─── Query Sanitization ──────────────────────────────────────────────────────

function sanitizeFtsQuery(query: string): string {
  let q = query.trim();
  if (!q) return '""';

  // Count quotes -- if odd, strip all quotes
  const quoteCount = (q.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    q = q.replace(/"/g, "");
  }

  // Remove standalone FTS5 operators that would cause syntax errors
  // but preserve them when used intentionally (e.g., "foo AND bar")
  q = q.replace(/\bNOT\s*$/i, "");
  q = q.replace(/^\s*NOT\b/i, "");

  // Remove unmatched parentheses
  let depth = 0;
  let cleaned = "";
  for (const ch of q) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth > 0) depth--;
      else continue; // skip unmatched closing paren
    }
    cleaned += ch;
  }
  // Strip remaining unmatched opening parens
  if (depth > 0) cleaned = cleaned.replace(/\(/g, "");
  q = cleaned;

  // If empty after sanitization, return original as quoted phrase
  q = q.trim();
  if (!q) return `"${query.replace(/"/g, "")}"`;

  return q;
}

// ─── Search Functions ─────────────────────────────────────────────────────────

interface SearchResult {
  path: string;
  title: string;
  type: string;
  tags: string[];
  score: number;
  snippet: string;
  wikilinks: string[];
  content?: string;
}

function ftsSearch(db: DatabaseSync, query: string, type?: string, tags?: string[], limit: number = 10): SearchResult[] {
  const ftsQuery = sanitizeFtsQuery(query);

  let sql = `
    SELECT d.id, d.path, d.title, d.type, d.tags, d.wikilinks,
           rank AS score,
           snippet(documents_fts, 1, ?, ?, ?, 20) AS snippet
    FROM documents_fts
    JOIN documents d ON d.id = documents_fts.rowid
    WHERE documents_fts MATCH ?
  `;
  const params: (string | number)[] = ["**", "**", "...", ftsQuery];

  if (type) {
    sql += " AND d.type = ?";
    params.push(type);
  }

  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);

  let rows: any[];
  try {
    rows = db.prepare(sql).all(...params);
  } catch {
    // FTS5 syntax error -- try keyword fallback
    const keywords = query.replace(/[^\w\s]/g, "").trim().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return [];
    const keywordQuery = keywords.join(" OR ");
    try {
      rows = db.prepare(sql).all("**", "**", "...", keywordQuery, ...(type ? [type] : []), limit);
    } catch {
      return [];
    }
  }

  return rows.map((r: any) => ({
    path: r.path,
    title: r.title || "(untitled)",
    type: r.type || "unknown",
    tags: safeParseTags(r.tags),
    score: r.score,
    snippet: r.snippet || "",
    wikilinks: safeParseJson(r.wikilinks),
  }));
}

function grepSearch(query: string, type?: string, limit: number = 10): SearchResult[] {
  // Build rg query: split into terms, search for any
  const terms = query.replace(/[^\w\s]/g, "").trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const pattern = terms.join("|");
  let cmd = `rg -il --type md "${pattern}" "${VAULT_DIR}" 2>/dev/null || true`;

  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
  } catch {
    return [];
  }

  let files = output.trim().split("\n").filter(Boolean);

  // Type filter: only include files in the matching subdirectory
  if (type) {
    files = files.filter((f) => {
      const rel = path.relative(VAULT_DIR, f);
      return rel.startsWith(type + "/") || rel.startsWith(type + "s/");
    });
  }

  return files.slice(0, limit).map((absPath) => {
    const relPath = path.relative(VAULT_DIR, absPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      return { path: relPath, title: relPath, type: "unknown", tags: [], score: 0, snippet: "", wikilinks: [] };
    }
    const note = parseNote(content);
    // Extract a snippet around the first match
    const snippet = extractSnippet(content, terms);
    return {
      path: relPath,
      title: note.title || relPath,
      type: note.type || "unknown",
      tags: note.tags,
      score: 0,
      snippet,
      wikilinks: note.wikilinks,
    };
  });
}

function extractSnippet(content: string, terms: string[]): string {
  // Find first occurrence of any term
  const lower = content.toLowerCase();
  let bestIdx = -1;
  for (const t of terms) {
    const idx = lower.indexOf(t.toLowerCase());
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx === -1) return content.slice(0, 150) + "...";

  const start = Math.max(0, bestIdx - 60);
  const end = Math.min(content.length, bestIdx + 120);
  let snippet = content.slice(start, end).replace(/\n/g, " ").trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet += "...";
  return snippet;
}

function tagFilter(results: SearchResult[], tags: string[]): SearchResult[] {
  if (!tags || tags.length === 0) return results;
  const required = new Set(tags.map((t) => t.toLowerCase()));
  return results.filter((r) => {
    const noteTags = new Set(r.tags.map((t) => t.toLowerCase()));
    for (const req of required) {
      if (!noteTags.has(req)) return false;
    }
    return true;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseJson(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function activate(pi: ExtensionAPI) {
  pi.registerTool({
    name: "vault_search",
    label: "Search",
    description:
      "Search the knowledge vault for notes matching a query. Uses FTS5 full-text search with BM25 ranking, " +
      "porter stemming, and snippet extraction. Falls back to ripgrep if FTS5 returns no results. " +
      "Supports FTS5 syntax: AND, OR, NOT, \"exact phrase\", prefix*. " +
      "For best results, try multiple specific queries rather than one broad query.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query. Natural language or FTS5 syntax." }),
      type: Type.Optional(
        StringEnum(["concept", "reference", "pattern", "project", "log", "moc"] as const, {
          description: "Filter by note type.",
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Filter to notes containing ALL of these tags." })
      ),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10, max 30)." })),
      mode: Type.Optional(
        StringEnum(["fts", "grep"] as const, { description: "Force search mode. Default: fts with grep fallback." })
      ),
      include_content: Type.Optional(
        Type.Boolean({ description: "Include full note content in results. Default false (snippets only)." })
      ),
    }),

    async execute(_toolCallId, params) {
      const database = getDb();
      const limit = Math.min(params.limit || 10, 30);
      const forceMode = params.mode || null;

      // Inline incremental re-index (fast: <10ms for typical changes)
      const indexStats = fullIndex(database);

      let results: SearchResult[];
      let mode: string;

      if (forceMode === "grep") {
        results = grepSearch(params.query, params.type, limit);
        mode = "grep";
      } else {
        // Try FTS5 first
        results = ftsSearch(database, params.query, params.type, limit);
        mode = "fts";

        // Fall back to grep if FTS5 returns nothing
        if (results.length === 0) {
          results = grepSearch(params.query, params.type, limit);
          mode = "grep (fallback)";
        }
      }

      // Apply tag filter (post-query, works for both modes)
      if (params.tags && params.tags.length > 0) {
        results = tagFilter(results, params.tags);
      }

      // Optionally include full content
      if (params.include_content) {
        for (const r of results) {
          try {
            r.content = fs.readFileSync(path.join(VAULT_DIR, r.path), "utf-8");
          } catch {
            r.content = "(file read error)";
          }
        }
      }

      // Format output
      const totalDocs = (database.prepare("SELECT COUNT(*) as c FROM documents").get() as any).c;

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results for "${params.query}" (searched ${totalDocs} notes via ${mode}). Try broader terms or different keywords.`,
            },
          ],
          details: { query: params.query, mode, total: 0, indexed: totalDocs },
        };
      }

      const lines = results.map((r, i) => {
        let line = `${i + 1}. **${r.title}** (${r.path}) [${r.type}]`;
        if (r.tags.length > 0) line += ` {${r.tags.join(", ")}}`;
        if (r.score) line += ` score:${r.score.toFixed(3)}`;
        if (r.snippet) line += `\n   ${r.snippet}`;
        if (r.wikilinks.length > 0) line += `\n   links: ${r.wikilinks.map((l) => `[[${l}]]`).join(", ")}`;
        if (r.content) line += `\n---\n${r.content}\n---`;
        return line;
      });

      const header = `${results.length} result(s) for "${params.query}" (${mode}, ${totalDocs} indexed)`;

      return {
        content: [{ type: "text" as const, text: `${header}\n\n${lines.join("\n\n")}` }],
        details: {
          query: params.query,
          mode,
          total: results.length,
          indexed: totalDocs,
          reindexed: indexStats.new + indexStats.updated + indexStats.deleted,
        },
      };
    },
  });

  // ── Command: /vault-reindex ───────────────────────────────────────────────

  pi.registerCommand({
    name: "/vault-reindex",
    description: "Force full re-index of the vault search database",
    execute: async () => {
      // Drop and recreate to force full rebuild
      if (db) {
        db.close();
        db = null;
      }
      if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

      const database = getDb(); // recreates schema + full index
      const totalDocs = (database.prepare("SELECT COUNT(*) as c FROM documents").get() as any).c;

      return `Vault search index rebuilt: ${totalDocs} notes indexed.`;
    },
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  pi.onDeactivate(() => {
    if (db) {
      db.close();
      db = null;
    }
  });
}
