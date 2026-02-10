#!/usr/bin/env bash
# validate-memory.sh -- Validate a memory JSONL file
#
# Usage: validate-memory.sh <memory_file>
#
# Checks:
#   1. File exists and is non-empty
#   2. Every line is valid JSON
#   3. Every entry has required fields (id, type, text)
#   4. Preferences have a category field
#   5. Reports entry counts by type and category
#
# Exit codes:
#   0 = valid
#   1 = validation failed

set -euo pipefail

MEMORY_FILE="${1:?Usage: validate-memory.sh <memory_file>}"

if [ ! -f "$MEMORY_FILE" ]; then
  echo "FAIL: File not found: $MEMORY_FILE" >&2
  exit 1
fi

if [ ! -s "$MEMORY_FILE" ]; then
  echo "FAIL: File is empty: $MEMORY_FILE" >&2
  exit 1
fi

node -e "
const fs = require('fs');
const file = process.argv[1];
const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
let errors = 0;
let learnings = 0;
let preferences = 0;
const categories = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;

  let entry;
  try {
    entry = JSON.parse(line);
  } catch (e) {
    console.error('FAIL: Line ' + (i + 1) + ' is not valid JSON: ' + e.message);
    errors++;
    continue;
  }

  if (!entry.id || typeof entry.id !== 'string') {
    console.error('FAIL: Line ' + (i + 1) + ' missing or invalid id');
    errors++;
  }
  if (!entry.type || (entry.type !== 'learning' && entry.type !== 'preference')) {
    console.error('FAIL: Line ' + (i + 1) + ' invalid type: ' + entry.type);
    errors++;
  }
  if (!entry.text || typeof entry.text !== 'string') {
    console.error('FAIL: Line ' + (i + 1) + ' missing or invalid text');
    errors++;
  }
  if (entry.type === 'preference' && !entry.category) {
    console.error('WARN: Line ' + (i + 1) + ' preference missing category (id: ' + entry.id + ')');
  }

  if (entry.type === 'learning') learnings++;
  if (entry.type === 'preference') {
    preferences++;
    const cat = entry.category || '(none)';
    categories[cat] = (categories[cat] || 0) + 1;
  }
}

// Check for duplicate IDs
const ids = lines.filter(l => l.trim()).map(l => { try { return JSON.parse(l).id; } catch { return null; } }).filter(Boolean);
const seen = new Set();
for (const id of ids) {
  if (seen.has(id)) {
    console.error('FAIL: Duplicate id: ' + id);
    errors++;
  }
  seen.add(id);
}

const total = learnings + preferences;
const sizeKB = (fs.statSync(file).size / 1024).toFixed(1);

if (errors > 0) {
  console.error('\\nVALIDATION FAILED: ' + errors + ' error(s)');
  process.exit(1);
}

console.log('OK: ' + total + ' entries (' + learnings + ' learnings, ' + preferences + ' preferences) ' + sizeKB + 'KB');
const catEntries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
if (catEntries.length > 0) {
  console.log('Categories: ' + catEntries.map(([k, v]) => k + '=' + v).join(', '));
}
" "$MEMORY_FILE"
