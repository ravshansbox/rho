---
name: memory-clean
description: Consolidate agent memory by reading the raw JSONL file, deduplicating entries, merging related items, pruning stale information, relocating reference material to the vault, and writing a clean replacement. Use when memory has grown large or contains duplicates.
---

# Memory Consolidation

## Overview

Consolidate an agent's memory file by reading the raw JSONL, deduplicating entries, merging related items, pruning stale or obsolete information, relocating reference-quality entries to the vault, and writing a clean replacement file. The goal is fewer, higher-quality entries that load faster and waste less context window, with richer knowledge preserved in the connected vault graph.

## Parameters

- **memory_file** (required): Path to the memory JSONL file (e.g., `~/.rho/brain/memory.jsonl`)

**Bundled resources:**
- `validate-memory.sh` — Validates a memory JSONL file (JSON parsing, required fields, duplicate IDs, category checks, entry counts). Run relative to this skill's directory.

**Constraints for parameter acquisition:**
- You MUST verify the memory file exists and is valid JSONL before proceeding (use `validate-memory.sh`)
- You MUST count the total entries and report the breakdown by type (learning, preference) and category

## Steps

### 1. Snapshot

Back up the current memory file before making changes.

**Constraints:**
- You MUST copy the file to `{memory_file}.bak-consolidation-{unix_timestamp}`
- You MUST verify the backup was written and has the same line count as the original
- You MUST NOT proceed if the backup fails because a bad consolidation with no backup means permanent data loss

### 2. Read and Categorize

Read the entire memory file. Group entries by topic or domain.

**Constraints:**
- You MUST read every line of the JSONL file
- You MUST parse each entry and preserve all fields: `id`, `type`, `text`, `category`, `used`, `last_used`, `created`
- You SHOULD group entries into logical clusters (e.g., "email system", "Termux/Android", "project naming", "X/Twitter posting")
- You MUST identify and flag:
  - **Exact or near-duplicates**: entries that say the same thing in slightly different words
  - **Superseded entries**: older entries contradicted or replaced by newer ones on the same topic
  - **Stale entries**: entries about things that no longer exist or no longer apply
  - **Overly specific entries**: one-off details that would not help a future session
  - **Merge candidates**: multiple entries about the same topic that could be combined into one tighter entry
  - **Vault candidates**: entries that contain reference-quality knowledge better served as connected vault notes (see Step 3)

### 3. Consolidate

Review all entries and produce a clean set.

**Constraints:**
- For each cluster of related entries, you MUST decide one of:
  - **Keep**: entry is unique, accurate, and useful as-is
  - **Rewrite**: entry is useful but should be tightened, clarified, or merged with related entries
  - **Drop**: entry is a duplicate, stale, superseded, or too specific to help future sessions
  - **Relocate to vault**: entry contains reference knowledge that is too detailed for a memory one-liner but worth preserving in the vault's connected graph
- When rewriting, you MUST preserve the `type` and `category` of the original entry
- When merging multiple entries into one, you MUST use the earliest `created` date and the latest `last_used` date from the merged set
- When merging, you MUST generate a new 8-character alphanumeric `id`
- You MUST NOT drop a preference entry unless it directly contradicts a newer preference because preferences represent explicit user intent and are harder to recover than learnings
- You MUST NOT invent new information during rewrites because consolidation reduces and clarifies, it does not add
- You SHOULD prefer specific, actionable entries over vague general ones
- You SHOULD keep entries that contain concrete values (URLs, paths, IDs, commands, thresholds) over entries that just describe concepts

#### Vault relocation criteria

An entry is a vault candidate when it meets any of these:
- **Architectural decisions**: design rationale, trade-off analysis, "we chose X because Y" entries that future sessions need context for, not just the fact
- **Strategy and market intel**: competitive analysis, positioning notes, research findings with sources
- **Multi-paragraph knowledge**: entries that are cramming too much into one line and would be clearer as a structured note
- **Reference material with links**: entries pointing to docs, vault paths, or strategy files that would benefit from being a proper note with connections
- **Project context**: detailed background on a project or feature that a new session would need to ramp up

An entry should stay in memory (not vault) when:
- It is a short, concrete fact (a path, an ID, a command, a credential location)
- It is a preference or behavioral directive
- It is a one-liner that works well as quick recall during a session
- It would be an orphan in the vault with no natural connections

### 4. Write Vault Notes

For each entry flagged for vault relocation, write a vault note.

**Constraints:**
- You MUST use the `vault write` tool to create each note
- Each note MUST have a `## Connections` section with `[[wikilinks]]` to related vault notes
- You MUST choose an appropriate note type: `concept`, `reference`, `pattern`, or `project`
- You SHOULD check if a related vault note already exists (via `vault search` or `vault list`) and merge into it rather than creating a duplicate
- If a relocated entry contains a concrete value that future sessions need quick access to (a path, URL, ID), you SHOULD leave a shorter replacement entry in memory pointing to the vault note (e.g., "Rho Cloud email architecture details in vault: email-architecture")
- You MUST NOT relocate an entry without writing the vault note first because dropping from memory without writing to vault means data loss

### 5. Write Consolidated File

Write the new memory file.

**Constraints:**
- You MUST write valid JSONL with one entry per line
- You MUST preserve the exact field schema: `{"id","type","text","category","used","last_used","created"}`
- Preferences MUST include the `category` field
- You MUST write to the original `memory_file` path, replacing the existing file
- You MUST run the bundled validation script to verify the output:
  ```bash
  ./validate-memory.sh {memory_file}
  ```
  This checks: every line parses as JSON, required fields present, preferences have categories, no duplicate IDs, and reports entry counts.
- If validation fails, restore from the backup and report the errors
- Do NOT use shell `read` loops to validate JSON -- embedded quotes get mangled. The script uses `node` for correct parsing.

### 6. Report

Summarize what changed.

**Constraints:**
- You MUST report:
  - Entry count before and after (total, by type)
  - Number of entries dropped, merged, rewritten, kept unchanged, relocated to vault
  - Vault notes created or updated (with slugs)
  - A brief list of the most significant merges or drops (up to 10)
- You SHOULD report the file size reduction
- You MUST NOT delete the backup file because the user may want to review or revert

## Examples

### Example Input
```
memory_file: "~/.rho/brain/memory.jsonl"
```

### Example Output
```
Backup: ~/.rho/brain/memory.jsonl.bak-consolidation-1738882903

Before: 332 entries (245 learnings, 87 preferences)
After:  189 entries (138 learnings, 51 preferences)

Dropped: 89 entries
  - 34 near-duplicates (e.g., 3 entries about npm org scope)
  - 22 superseded (e.g., old domain references replaced by rhobot.dev)
  - 18 overly specific (e.g., one-off debug findings)
  - 15 stale (e.g., references to removed features)

Merged: 45 entries into 18
  - 5 Tasker entries -> 2 consolidated entries
  - 4 video editing entries -> 1 entry
  - 3 email tier/pricing entries -> 1 entry

Relocated to vault: 9 entries -> 4 notes
  - 3 email architecture entries -> [[rho-cloud-email-architecture]] (updated existing)
  - 2 market scan entries -> [[2026-02-market-scan]] (new reference note)
  - 2 Hats rename entries -> [[hats-rename-strategy]] (new project note)
  - 2 Dark Factory entries -> merged into existing [[dark-factory-bdd-strategy]]

Rewritten: 12 entries (tightened wording)
Kept unchanged: 177 entries

File size: 48KB -> 27KB
```

## Troubleshooting

### Memory file is very large (500+ entries)
Run consolidation more frequently. If the file exceeds what fits comfortably in context, split it in half, consolidate each half, then do a final merge pass.

### Agent is uncertain whether to drop an entry
Keep it. The cost of one extra entry is lower than the cost of losing useful context. Flag it for the user to review manually.

### Contradictory entries found
Keep the newer entry (by `created` date). If both have value, merge into one entry that captures the current state and notes the change.

### Vault note already exists for a topic
Use `vault read` to check the existing note. Merge the memory entry's content into the existing note rather than creating a duplicate. Update the `## Connections` section if new links are warranted.

### Entry is borderline between memory and vault
If the entry works as a one-liner, keep it in memory. The vault is for entries that need structure, connections, or more than a sentence to be useful. When in doubt, keep in memory.
