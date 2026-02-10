#!/usr/bin/env bash
#
# test-memory-consolidate.sh — LLM-in-the-loop test for the memory-consolidate SOP.
#
# Creates a synthetic brain.jsonl full of problems (dupes, near-dupes, stale,
# merge candidates, contradictions), runs pi --no-session with the SOP,
# then validates the result.
#
# Usage:
#   ./tests/test-memory-consolidate.sh [--dry-run] [--model <model>]
#
# Requires: pi, npx tsx, jq
#
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=false
MODEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --model)   MODEL="$2"; shift 2 ;;
    *)         echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Setup temp dir ─────────────────────────────────────────────────

TMPDIR=$(mktemp -d)
BRAIN="$TMPDIR/brain.jsonl"
trap 'rm -rf "$TMPDIR"' EXIT

echo "=== Memory Consolidation Test ==="
echo "Temp dir: $TMPDIR"
echo "Dry run:  $DRY_RUN"
[[ -n "$MODEL" ]] && echo "Model:    $MODEL"
echo ""

# ── Generate synthetic brain.jsonl ─────────────────────────────────

npx tsx tests/generate-synthetic-brain.ts "$BRAIN"

BEFORE_LINES=$(wc -l < "$BRAIN" | tr -d ' ')
BEFORE_LEARNINGS=$(grep -c '"type":"learning"' "$BRAIN" || true)
BEFORE_PREFS=$(grep -c '"type":"preference"' "$BRAIN" || true)
BEFORE_BEHAVIORS=$(grep -c '"type":"behavior"' "$BRAIN" || true)

echo "Generated synthetic brain:"
echo "  Total lines:  $BEFORE_LINES"
echo "  Learnings:    $BEFORE_LEARNINGS"
echo "  Preferences:  $BEFORE_PREFS"
echo "  Behaviors:    $BEFORE_BEHAVIORS"
echo ""

# ── Build the prompt ───────────────────────────────────────────────

SOP_PATH="$(pwd)/sops/memory-consolidate.sop.md"

DRY_FLAG=""
if $DRY_RUN; then
  DRY_FLAG="Set dry_run=true — only output the change plan, do not apply."
fi

PROMPT="You are running memory consolidation on a brain.jsonl file.

Follow the SOP at: $SOP_PATH

The brain tool is already configured to use the file at: $BRAIN

$DRY_FLAG

Start by running brain action=list to inventory entries, then follow every step in the SOP.
At the end, output your consolidation report."

echo "=== Running pi --no-session ==="
echo ""

# ── Run pi ─────────────────────────────────────────────────────────

MODEL_FLAG=""
[[ -n "$MODEL" ]] && MODEL_FLAG="--model $MODEL"

RHO_BRAIN_PATH="$BRAIN" RHO_BRAIN_DIR="$TMPDIR" \
  pi -p --no-session $MODEL_FLAG "$PROMPT" 2>&1 | tee "$TMPDIR/pi-output.txt"

echo ""
echo "=== Validation ==="
echo ""

# ── Validate results ───────────────────────────────────────────────

if $DRY_RUN; then
  echo "Dry run — skipping mutation validation."
  echo "Check $TMPDIR/pi-output.txt for the change plan."
  # Keep tmpdir for inspection
  trap - EXIT
  echo "Temp dir preserved: $TMPDIR"
  exit 0
fi

AFTER_LINES=$(wc -l < "$BRAIN" | tr -d ' ')

# Use brain-store to get accurate folded counts
AFTER_STATS=$(RHO_BRAIN_PATH="$BRAIN" npx tsx -e "
import { readBrain, foldBrain } from './extensions/lib/brain-store.ts';
const { entries, stats } = readBrain('$BRAIN');
const brain = foldBrain(entries);
const out = {
  total_lines: stats.total,
  bad_lines: stats.badLines,
  learnings: brain.learnings.length,
  preferences: brain.preferences.length,
  behaviors: brain.behaviors.length,
  tasks: brain.tasks.length,
  tombstones: brain.tombstoned.size,
};
console.log(JSON.stringify(out));
")

echo "After consolidation:"
echo "  Raw lines:   $AFTER_LINES"
echo "  Stats:       $AFTER_STATS"
echo ""

# Parse stats
AFTER_LEARNINGS=$(echo "$AFTER_STATS" | jq -r '.learnings')
AFTER_PREFS=$(echo "$AFTER_STATS" | jq -r '.preferences')
AFTER_BEHAVIORS=$(echo "$AFTER_STATS" | jq -r '.behaviors')
TOMBSTONES=$(echo "$AFTER_STATS" | jq -r '.tombstones')
BAD_LINES=$(echo "$AFTER_STATS" | jq -r '.bad_lines')

PASS=0
FAIL=0

check() {
  local label="$1" cond="$2"
  if eval "$cond"; then
    echo "  PASS: $label"
    ((PASS++))
  else
    echo "  FAIL: $label"
    ((FAIL++))
  fi
}

# Core invariants
check "no bad lines in brain.jsonl" "[[ $BAD_LINES -eq 0 ]]"
check "behaviors untouched (still $BEFORE_BEHAVIORS)" "[[ $AFTER_BEHAVIORS -eq $BEFORE_BEHAVIORS ]]"
check "at least 1 tombstone created" "[[ $TOMBSTONES -gt 0 ]]"
check "learnings reduced" "[[ $AFTER_LEARNINGS -lt $BEFORE_LEARNINGS ]]"
check "file is append-only (lines >= before)" "[[ $AFTER_LINES -ge $BEFORE_LINES ]]"

# The synthetic brain has 5 exact/near-duplicate learnings.
# A good consolidation should catch at least 3 of them.
LEARNINGS_REMOVED=$((BEFORE_LEARNINGS - AFTER_LEARNINGS))
check "removed at least 3 duplicate/stale learnings" "[[ $LEARNINGS_REMOVED -ge 3 ]]"

# The synthetic brain has 2 contradictory preferences (old + new).
# Good consolidation keeps the newer one.
# Check that the newer preference text is still present
NEWER_PREF_PRESENT=$(RHO_BRAIN_PATH="$BRAIN" npx tsx -e "
import { readBrain, foldBrain } from './extensions/lib/brain-store.ts';
const { entries } = readBrain('$BRAIN');
const brain = foldBrain(entries);
const has = brain.preferences.some(p => p.text.includes('tabs for indentation'));
console.log(has ? 'yes' : 'no');
")
check "newer contradictory preference kept" "[[ '$NEWER_PREF_PRESENT' == 'yes' ]]"

# The 5 'keep' learnings should all survive
KEEP_SURVIVED=$(RHO_BRAIN_PATH="$BRAIN" npx tsx -e "
import { readBrain, foldBrain } from './extensions/lib/brain-store.ts';
const { entries } = readBrain('$BRAIN');
const brain = foldBrain(entries);
const keepers = [
  'API rate limit is 100 requests per minute per key',
  'Always run tests before committing',
  'The deploy pipeline takes 12 minutes',
  'Use pnpm not npm in this monorepo',
  'Fish shell config lives in ~/.config/fish',
];
const found = keepers.filter(k => brain.learnings.some(l => l.text.includes(k)));
console.log(found.length);
")
check "all 5 keeper learnings survived" "[[ '$KEEP_SURVIVED' == '5' ]]"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

# Preserve tmpdir on failure for debugging
if [[ $FAIL -gt 0 ]]; then
  trap - EXIT
  echo "Temp dir preserved for debugging: $TMPDIR"
  exit 1
fi
