# Pi-native extensions execution plan (Rho)

Status: draft (2026-02-08)

## Why this spec exists

Rho already ships multiple Pi extensions (`extensions/rho`, `extensions/email`, `extensions/vault-search`, etc.), but several high-value workflows are still *skills* (runbooks) or *external CLIs* (e.g., `~/bin/xapi`). This plan turns the current recommendations into an execution sequence that:

- Keeps **email** as an extension (already done).
- Converts **X posting (xapi)** into a **native extension** (tooling + queue + minimal overlays), without breaking the existing CLI initially.
- Enhances **vault-search** with a **browse/search overlay**.
- Adds a **tasks overlay** (UI), building on the existing `tasks` tool/store.
- Optionally wraps **session-digest** as a tool.

This is a *delivery plan*, not an implementation.

---

## Architecture note: extension vs skill vs CLI

### Principles

1. **Extensions own runtime behavior and interactivity**
   - Things that must run automatically (lifecycle hooks, background polling, interceptors)
   - Things that need UI (overlays, prompts, confirmations)
   - Things the LLM must call as structured tools

2. **Skills are runbooks, not infrastructure**
   - Repeatable procedures that use built-in tools (`bash`, `read`, `edit`, `write`) and Rho tools (`vault`, `tasks`, `email`)
   - Portable across models and agent harnesses

3. **CLIs are acceptable for power-user workflows, but not required for core product**
   - We can ship “extension wraps CLI” as an MVP, but the roadmap should converge to “extension works without bespoke user scripts”.

### Where each feature should live

| Feature | Where it lives | Why |
|---|---|---|
| Agent email inbox + send | `extensions/email` | Needs tools + notifications + persistent config. Already good. |
| Brain + heartbeat + vault core + tasks store | `extensions/rho` | Lifecycle hooks (`session_start`, `turn_start`, heartbeat), tool surface (`memory`, `tasks`, `vault`). |
| Vault full-text search | `extensions/vault-search` | Already a clean, focused tool + reindex command. |
| Vault browse/search UI | **Add to** `extensions/vault-search` | Keeps “search + browse” cohesive and reuses `VaultSearch` indexer. |
| Tasks UI overlay | **New extension** `extensions/tasks-ui` (or split from core) | UI should stay modular; core `tasks` tool should remain usable headlessly. |
| X posting + queue + corrections | **New extension** `extensions/x` (or `extensions/xapi`) | Needs tight UX loops (queue review, confirmation) and structured tool surface. |
| X search | Keep `extensions/x-search` | Different capability than posting; separate auth/cost profile. |
| session-digest wrapper tool | Optional new extension `extensions/session-digest` | Useful for LLM-native log inspection; should remain optional because it is power-user oriented. |

---

## Execution milestones (prioritized)

Milestones are ordered to minimize risk and unblock the UI work.

### Milestone M1: Foundations (shared stores, locking, compatibility)

**Goal:** make the on-disk stores safe and shareable across extensions.

- Extract (or mirror) the tasks store logic from `extensions/rho/index.ts` into `extensions/lib/tasks-store.ts`.
- Add file locking (or atomic write strategy) so overlays and heartbeats can read/write safely.
- Define a stable on-disk schema for X queue/corrections/logs.

### Milestone M2: Minimal overlays (tasks + vault)

**Goal:** deliver “useful UI fast” using `ctx.ui.custom({ overlay: true })`, without changing the underlying tool contracts.

- Tasks overlay MVP
- Vault browse/search overlay MVP

### Milestone M3: X posting extension MVP

**Goal:** “review queue → confirm → post” loop fully inside Pi.

- Tool/command surface
- Queue store
- Minimal overlay
- Migration plan that keeps `~/bin/xapi` working

### Milestone M4 (optional): session-digest tool wrapper

**Goal:** make session log inspection callable by the LLM as a tool (for debugging + retro work).

---

## Backlog (with acceptance tests)

Estimates are rough: S (0.5–1 day), M (2–4 days), L (1–2 weeks).

| ID | Priority | Item | Est | Depends on | Acceptance (summary) |
|---|---:|---|---:|---|---|
| B1 | P1 | Spec: pi-native extensions execution plan | S | – | This spec exists in `specs/` and includes architecture + backlog + risks. |
| B2 | P2 | Shared tasks store module + locking | M | – | Concurrent writers do not corrupt `~/.rho/tasks.jsonl`. UI + heartbeat can read safely. |
| B3 | P3 | Tasks overlay MVP (`/tasks` UI) | M | B2 | In interactive mode, `/tasks` opens overlay with list/add/done/remove. Headless mode stays text-only. |
| B4 | P3 | Vault browse/search overlay MVP (`/vault-search`) | M | – | Search box + result list + preview; can insert `[[wikilink]]` into editor. |
| B5 | P2 | X on-disk data model (queue + corrections + post log) | M | – | Extension + CLI can read same files without breaking. JSONL lines validate. |
| B6 | P2 | X extension MVP tool surface (`x_*` tool) | L | B5 | LLM can queue drafts, list queue, and post with confirmation gate. |
| B7 | P2 | X overlay MVP (`/x` queue review) | M | B6 | User can review queued drafts, approve, then post. |
| B8 | P4 | session-digest wrapper tool | S | – | Tool returns digest for current session with size limits. |

### Acceptance tests (BDD scenarios)

The canonical acceptance tests should live under `features/` (Gherkin). This spec expects new files:

- `features/tasks-overlay.feature`
- `features/vault-browse-overlay.feature`
- `features/x-posting-extension.feature`
- (optional) `features/session-digest-tool.feature`

---

## Proposed extension surfaces

### 1) X posting extension (convert xapi into native extension)

#### Naming

- Extension directory: `extensions/x/` (short, matches `/x`)
- Tool name: `x_post` (posting) and `x_queue` (queue ops), or a single `x` tool with `action` enum.

Recommendation: **single tool** named `x` with `action` enum, mirroring the `tasks` tool shape. This keeps the tool surface stable and discoverable.

#### Tool surface (proposal)

Tool: `x`

Parameters:

- `action`: `"draft" | "queue_add" | "queue_list" | "queue_remove" | "queue_clear" | "post" | "reply" | "thread" | "correct"`
- `profile?`: string (defaults to `tau`, but MUST be explicit in stored queue entries)
- `text?`: string
- `in_reply_to?`: string (tweet id)
- `dry_run?`: boolean (returns what would happen without posting)
- `confirm?`: boolean (default true in interactive sessions)

Minimum viable behaviors:

- `draft`: returns a draft (optionally applying corrections rules).
- `queue_add`: appends entry to queue store.
- `queue_list`: returns queue entries (summary + IDs).
- `post`: posts immediately (with confirmation gate when interactive).
- `correct`: appends a correction entry.

#### Slash command UX (proposal)

Command: `/x`

- `/x` (no args): open **queue overlay**
- `/x post <text>`: posts after confirmation
- `/x queue`: open queue overlay
- `/x correct`: opens small input flow (bad/good/rule) or delegates to tool

#### On-disk data model (compatibility-first)

To keep `~/bin/xapi` working initially, the extension should treat **existing xpost files as canonical**.

Directory (preferred): `~/.config/xpost/`

Files:

- `~/.config/xpost/corrections.jsonl`
- `~/.config/xpost/post-log.jsonl`
- `~/.config/xpost/queue.jsonl` (new)

Queue entry (JSONL, one object per line):

```json
{
  "id": "q_20260208_01H...",
  "created": "2026-02-08T05:12:34.000Z",
  "profile": "tau",
  "kind": "post",
  "text": "...",
  "in_reply_to": null,
  "media": [],
  "status": "queued",
  "sentAt": null,
  "tweetId": null,
  "error": null
}
```

Corrections entry (append-only):

```json
{ "bad": "...", "good": "...", "rule": "...", "created": "2026-02-08T...Z" }
```

**Compatibility contract:**

- The extension MUST only append new files/fields; it MUST NOT rewrite existing correction entries.
- If the CLI doesn’t know about `queue.jsonl`, it can ignore it.
- When the CLI is later upgraded, it can start consuming `queue.jsonl` without migrations.

#### Minimal overlay flow (queue review)

Use `ctx.ui.custom(..., { overlay: true, overlayOptions: ... })` to implement:

- Left pane: queued items list (ID, first 60 chars, profile)
- Right pane: full text preview + computed length (280 cap)
- Keys:
  - `Enter`: approve/post selected (prompts confirm)
  - `d`: delete from queue
  - `a`: add new queued draft (opens input)
  - `r`: refresh
  - `Esc`: close

Posting must be gated:

- Interactive: `await ctx.ui.confirm("Post to X?", preview)`
- Headless: fail with a clear error unless `confirm: false` is explicitly passed.

#### Migration plan (keep existing CLI working)

Phase 1 (MVP): extension reads/writes queue/corrections/logs, but **delegates the actual post** to the existing CLI if present (e.g., `xapi --profile <p> post ...`).

- Pros: reuses existing auth, zero token work
- Cons: not portable to fresh installs

Phase 2: implement native posting using X API credentials stored in a Rho-managed location (or reuse `xapi` config if it is standardized).

---

### 2) Vault browse/search overlay (enhance vault-search)

Add a command to `extensions/vault-search`:

- `/vault-search` opens an overlay search UI.

MVP UI:

- Query input at top
- Results list (title/type/tags)
- Preview pane reads file content directly from `r.path`
- Action: `Enter` inserts `[[slug]]` into editor via `ctx.ui.pasteToEditor()`

No new tool required initially; reuse `VaultSearch` directly in extension code.

---

### 3) Tasks overlay MVP (new extension)

Create `extensions/tasks-ui` with a single command:

- `/tasks` (interactive, no args) opens overlay.
- `/tasks ...` (args) falls back to the existing text command in `extensions/rho` until we migrate.

MVP UI actions:

- list pending tasks
- add task
- mark done
- remove task
- filter by tag

Implementation should read/write `~/.rho/tasks.jsonl` using the shared store module (post-locking).

---

### 4) session-digest wrapper tool (optional)

Add a tool `session_digest` that:

- Defaults to “current session only”
- Supports limits (`maxTurns`, `maxChars`) to prevent runaway output
- Can optionally call the existing `session-digest` script if present

---

## Suggested file layout

Proposed additions (no implementation in this task):

```
extensions/
  x/
    index.ts
    README.md
    ui/
      queue-overlay.ts
    store/
      queue.ts
      corrections.ts
  tasks-ui/
    index.ts
    ui/
      tasks-overlay.ts
  vault-search/
    index.ts              # add /vault-search overlay command here
    ui/
      vault-search-overlay.ts
extensions/lib/
  tasks-store.ts           # extracted from extensions/rho
  x-store.ts               # xpost queue/log/corrections paths + JSONL helpers
  overlays/
    list-pane.ts           # optional shared TUI widgets (if worth it)
```

Testing layout:

```
tests/
  test-x-store.ts
  test-tasks-ui-store.ts
```

Notes:

- Pi loader rule: do not add `extensions/lib/index.ts`.
- Keep logic testable by isolating store + transforms in `extensions/lib/*`.

---

## Pi extension APIs to use (by feature)

### For all new extensions

- `pi.registerTool(...)` for LLM-callable actions
- `pi.registerCommand(...)` for `/x`, `/vault-search`, `/tasks` entrypoints
- `pi.on("session_start" | "session_shutdown" | "turn_start" ...)` for wiring, timers, and state hydration

### For overlays

- `ctx.ui.custom(factory, { overlay: true, overlayOptions: ... })`
- `ctx.ui.notify(...)` for non-modal feedback
- `ctx.ui.confirm(...)` as the “posting gate”
- `ctx.ui.input(...)` / `ctx.ui.select(...)` for simple steps (where custom TUI is overkill)

### For persistence

- Prefer explicit on-disk stores under `~/.rho/` or `~/.config/xpost/`.
- Use `pi.appendEntry(customType, data)` only for *session-local* state (e.g., last-selected queue item), and restore via `ctx.sessionManager.getEntries()`.

### For cross-extension wiring (optional)

- `pi.events.emit(...)` / `pi.events.on(...)` when one extension needs to update another (pattern used in `extensions/usage-bars`).

---

## Risks and unknowns

1. **Overlay ergonomics are terminal-dependent**
   - Different `rows/cols`, tmux splits, mobile Termux.

2. **Concurrency and JSONL corruption**
   - Tasks overlay + heartbeat + tool calls can collide. Locking is a prerequisite.

3. **X posting safety**
   - Accidental posts are expensive. Default to confirmation gates.

4. **Credential portability for X**
   - Wrapping `~/bin/xapi` is pragmatic but not portable.
   - Native posting requires deciding on a credential format and onboarding.

5. **Vault note size + preview performance**
   - Large notes may need truncation and lazy loading.

---

## Out of scope (explicit non-goals)

- Rewriting the `extensions/rho` core runtime.
- Changing vault schema rules or note validation.
- Building a full “Notion-like” vault UI.
- Shipping a complete X API credential manager.
