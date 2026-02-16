---
name: memory-consolidate
description: Consolidate brain memory and mine user sessions since the last consolidation checkpoint (sleep-cycle style). Use to reduce noisy prompt injection while preserving durable high-value memories.
kind: sop
---

# Memory Consolidate

## Overview

Run a "brain sleep cycle":
1. Consolidate existing memory (dedupe, decay, merge, vault relocation)
2. Mine **user** sessions since the last consolidation checkpoint
3. Persist a new checkpoint only after a successful run

Use the `brain` tool for brain changes and the `vault` tool for reference relocation. Never edit `brain.jsonl` directly.

---

## Importance levels (retention)

Use these symbols while triaging entries:
- 🔴 **High importance** — durable, high-leverage, should remain in brain
- 🟡 **Medium importance** — useful but optional; review for merge/tightening
- 🟢 **Low importance** — stale/noisy/duplicative; prune or relocate

> For memory retention, **high importance means keep longer**, not delete.

---

## Parameters

- **brain_path** (default: `~/.rho/brain/brain.jsonl`)
- **mine_sessions** (default: `true`)
- **since** (default: `last_consolidation`) — `last_consolidation | <ISO timestamp> | <duration>`
- **days_fallback** (default: `1`) — only used when no checkpoint exists
- **session_dir** (default: `~/.pi/agent/sessions/`)
- **max_new_entries** (default: `10`)
- **confidence_threshold** (default: `high`) — `high | medium`
- **checkpoint_key** (default: `memory_consolidate.last_consolidated_at`)

---

## Steps

### 1) Inventory

List memory by type and count totals.

**You MUST report counts for:**
- learnings, preferences, behaviors, identity, user, context, tasks, reminders
- total active entries

### 2) Resolve mining window

Determine the lower bound timestamp:
1. If `since` is explicit timestamp/duration, use it.
2. If `since=last_consolidation`, read checkpoint from `checkpoint_key`.
3. If no checkpoint exists, use `days_fallback`.

**Constraints:**
- You MUST mine only sessions in the resolved window.
- You MUST include the resolved window in the final report.

### 3) Session mining (user messages only)

Extract durable learnings/preferences from user messages in matched sessions.

Confidence policy:
- **High**: explicit user statements/corrections/preferences → auto-add
- **Medium**: strong multi-session inference → add only if threshold is `medium`
- **Low**: ambiguous/one-off/hypothetical → skip

**Constraints:**
- You MUST NOT exceed `max_new_entries`.
- You MUST dedupe against existing memory before add.
- You MUST prefer high-confidence extractions first.
- You MUST include session id in `source` when available (`session:<id>`).

### 4) Decay stale learnings

Run `brain action=decay`.

**Constraints:**
- You MUST report decayed count.

### 5) Consolidate existing entries

Identify duplicates/superseded/stale entries and merge candidates.

Apply the importance lens:
- 🔴 Keep durable, high-value operational guidance
- 🟡 Merge or tighten wording
- 🟢 Remove if stale/noisy/redundant

**Constraints:**
- You MUST NOT remove preferences unless contradicted/superseded.
- You MUST NOT invent new facts while merging.
- When uncertain, keep.

### 6) Vault relocation for reference-heavy entries

"Reference-heavy" means useful knowledge that does **not** need to be injected every turn and can be searched ad hoc.

Typical candidates:
- long feature histories / changelog-style learnings
- architecture rationale requiring structure
- multi-step runbooks / deep troubleshooting notes
- linked research/reference material

**Constraints:**
- You MUST write vault notes before removing corresponding brain entries.
- Each note MUST include `## Connections` with `[[wikilinks]]`.
- Leave a short pointer memory when useful (e.g., "See [[note-slug]]").

### 7) Persist checkpoint (success only)

At end of successful consolidation, set/update checkpoint timestamp (`now`, UTC ISO-8601).

**Constraints:**
- You MUST update checkpoint only after successful completion.
- You MUST NOT advance checkpoint on partial/failed runs.

### 8) Report

You MUST report:
- counts before/after by type + total
- mining window and sessions analyzed
- added/skipped mined entries (with skip reasons)
- decayed, removed, merged, relocated counts
- vault notes created/updated (slugs)
- checkpoint old → new value
- up to 10 significant changes

