---
name: memory-clean
description: Consolidate agent memory by decaying stale entries, removing duplicates, relocating reference material to the vault, and automatically mining recent sessions for new learnings. Use when memory has grown large, contains duplicates, or when you want to extract insights from recent conversations.
---

# Memory Clean

## Overview

Consolidate and expand the agent's brain by:
1. **Cleaning**: Decay stale learnings, remove duplicates, merge related entries, relocate reference material to the vault
2. **Mining** (optional): Automatically extract new learnings and preferences from recent session logs

Uses the `brain` tool for all modifications — never edits brain.jsonl directly.

## Parameters

- **brain_path** (default: `~/.rho/brain/brain.jsonl`): Path to the brain file
- **mine_sessions** (default: `true`): If true, automatically mine recent session logs for new learnings
- **days** (default: `1`): How many days of sessions to mine (only if mine_sessions=true)
- **session_dir** (default: `~/.pi/agent/sessions/`): Where pi session logs live
- **max_new_entries** (default: `10`): Maximum new entries to add from session mining per run
- **confidence_threshold** (default: `high`): Minimum confidence level for auto-adding entries (`high` = explicit statements only, `medium` = strong inferences ok)

## Steps

### 1. Inventory

Run `brain action=list` for each type to get the full picture.

**Constraints:**
- You MUST count entries by type: learnings, preferences, behaviors, identity, user, context, tasks, reminders
- You MUST note the total entry count

### 2. Session Mining (if mine_sessions=true)

Read recent session logs and automatically extract learnings/preferences.

**Find sessions:**
- Look for session JSONL files in `session_dir`
- Filter to sessions from the last `days` days
- Skip if no sessions found

**Extract and add automatically:**

Read each session and extract facts with confidence levels:

| Confidence | Criteria | Action |
|---|---|---|
| **High** | User explicitly states a preference, fact, or opinion; or corrects/clarifies something | Auto-add to brain |
| **Medium** | Strong pattern from multiple sessions; clear inference but not explicitly stated | Auto-add if confidence_threshold=medium |
| **Low** | One-off mention; ambiguous; could be misinterpreted | Skip entirely |

**Auto-add constraints:**
- You MUST NOT exceed `max_new_entries` per run
- You MUST deduplicate against existing entries (skip if similar entry already exists)
- You MUST prefer high-confidence extractions first
- You MUST extract from user messages only, not agent responses
- You MUST store the session ID in the entry source field when available

**Example high-confidence extractions:**
- User says: "I prefer 2-space indentation" → `preference category="Code" value="2-space indentation"`
- User says: "Don't use React for this, use Vue" → `learning text="User prefers Vue over React for new projects"`
- User corrects: "No, I meant the other file" → `learning text="User is specific about file references - always confirm"`

**Skip these:**
- Hypotheticals: "I might try Go someday"
- Questions: "Should I use Postgres?"
- Agent suggestions user didn't explicitly confirm/reject
- Anything that could be session-specific context vs enduring preference

### 3. Decay Stale Learnings

Run `brain action=decay` to automatically archive learnings that haven't been reinforced.

**Constraints:**
- This uses the configured `decay_after_days` (default 90) and `decay_min_score` (default 3)
- Report how many entries were decayed

### 4. Identify Duplicates and Merges

Review learnings and preferences for:
- **Exact or near-duplicates**: entries that say the same thing in slightly different words
- **Superseded entries**: older entries contradicted or replaced by newer ones
- **Stale entries**: entries about things that no longer exist or apply
- **Merge candidates**: multiple entries about the same topic that could be combined
- **Vault candidates**: entries with reference-quality knowledge better served as vault notes

**Constraints:**
- You MUST NOT remove a preference unless it directly contradicts a newer preference
- You MUST NOT invent new information — consolidation reduces and clarifies, it does not add
- You SHOULD prefer specific, actionable entries over vague general ones

### 5. Clean Up

For each entry to remove or replace:
- Use `brain action=remove id=<id> reason="..."` to tombstone duplicates/stale entries
- Use `brain action=add type=learning text="..."` to add merged replacements
- Use `brain action=update id=<id> text="..."` to tighten wording on existing entries

**Constraints:**
- When merging multiple entries into one, remove the originals and add a new combined entry
- You MUST NOT remove entries without good reason — when uncertain, keep them

### 6. Vault Relocation

For entries flagged as vault candidates:

**Vault relocation criteria:**
- Architectural decisions and design rationale
- Multi-paragraph knowledge crammed into one line
- Reference material with links that would benefit from being a proper note
- Detailed project context that a new session would need to ramp up

**Constraints:**
- You MUST use the `vault write` tool to create each note before removing the brain entry
- Each vault note MUST have a `## Connections` section with `[[wikilinks]]`
- If a relocated entry has a concrete value needed for quick recall, leave a shorter replacement in the brain pointing to the vault note
- You MUST NOT remove a brain entry without writing the vault note first

### 7. Report

Summarize what changed.

**Constraints:**
- You MUST report:
  - Entry count before and after (total, by type)
  - Session mining: sessions analyzed, new entries added, skipped (with reasons)
  - Number of entries decayed, removed, merged, kept unchanged, relocated to vault
  - Vault notes created or updated (with slugs)
  - A brief list of the most significant changes (up to 10)

## Examples

### Example Output (clean only)
```
Before: 332 entries (245 learnings, 87 preferences)
After:  189 entries (138 learnings, 51 preferences)

Decayed: 42 stale learnings (>90 days, score <3)
Removed: 47 entries
  - 34 near-duplicates
  - 13 superseded or stale

Merged: 12 groups into 5 entries
Relocated to vault: 4 entries -> 2 notes
  - [[rho-email-architecture]] (new)
  - [[market-scan-2026-02]] (new)

Kept unchanged: 177 entries
```

### Example Output (with mining)
```
Before: 145 entries (89 learnings, 56 preferences)

Session Mining (last 1 day):
- Analyzed: 3 sessions
- High confidence extractions: 4
- Added: 4 new entries (under max_new_entries=10)
- Skipped: 2 low-confidence (ambiguous, one-off mentions)

After:  149 entries (92 learnings, 57 preferences)

Decayed: 3 stale learnings
Removed: 8 duplicates
Merged: 2 groups into 1 entry

Kept unchanged: 138 entries
```

## Troubleshooting

### Agent is uncertain whether to remove an entry
Keep it. The cost of one extra entry is lower than the cost of losing useful context.

### Contradictory entries found
Keep the newer entry. If both have value, merge into one that captures the current state.

### Entry is borderline between memory and vault
If it works as a one-liner, keep it in the brain. The vault is for entries that need structure or connections.

### Too many entries being added from sessions
Lower `max_new_entries` or raise confidence to `high` to be more selective.

### Mining adds wrong inferences
This happens with medium confidence. Switch to `confidence_threshold=high` to only extract explicit statements.
