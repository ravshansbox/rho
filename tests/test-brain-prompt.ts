/**
 * Tests for buildBrainPrompt() budgeted renderer.
 * Run: npx tsx tests/test-brain-prompt.ts
 */

import {
  buildBrainPrompt,
  foldBrain,
  type BrainEntry,
  type MaterializedBrain,
  type BehaviorEntry,
  type LearningEntry,
  type PreferenceEntry,
  type ContextEntry,
} from "../extensions/lib/brain-store.ts";

// ── Test Harness ──────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS: ${label}`);
    PASS++;
  } else {
    console.error(`  FAIL: ${label}`);
    FAIL++;
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS: ${label}`);
    PASS++;
  } else {
    console.error(`  FAIL: ${label} -- expected ${e}, got ${a}`);
    FAIL++;
  }
}

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function emptyBrain(): MaterializedBrain {
  return {
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
}

// ── Tests ─────────────────────────────────────────────────────────

console.log("\n--- empty brain ---");
{
  const brain = emptyBrain();
  const result = buildBrainPrompt(brain, "/tmp");
  assertEq(result, "", "empty brain → empty string");
}

console.log("\n--- budget enforced (small) ---");
{
  const brain = emptyBrain();
  for (let i = 0; i < 50; i++) {
    brain.learnings.push({
      id: `l${i}`,
      type: "learning",
      created: daysAgo(i),
      text: `Learning number ${i}: this is some text that takes up tokens in the prompt output for budget testing purposes`,
    } as LearningEntry);
  }
  const result = buildBrainPrompt(brain, "/tmp", { promptBudget: 500 });
  const tokens = approxTokens(result);
  assert(tokens <= 500, `budget=500 enforced: got ${tokens} tokens`);
  assert(tokens > 0, `budget=500 produces output: got ${tokens} tokens`);
}

console.log("\n--- budget enforced (default 2000) ---");
{
  const brain = emptyBrain();
  for (let i = 0; i < 200; i++) {
    brain.learnings.push({
      id: `l${i}`,
      type: "learning",
      created: daysAgo(i),
      text: `Learning ${i}: a longer piece of content that should eventually exhaust the budget allocation for the learnings section of the brain prompt`,
    } as LearningEntry);
  }
  const result = buildBrainPrompt(brain, "/tmp");
  const tokens = approxTokens(result);
  assert(tokens <= 2000, `default budget=2000 enforced: got ${tokens} tokens`);
}

console.log("\n--- section order ---");
{
  const brain = emptyBrain();
  brain.behaviors.push({
    id: "b1", type: "behavior", created: daysAgo(0), category: "do", text: "Be direct",
  } as BehaviorEntry);
  brain.preferences.push({
    id: "p1", type: "preference", created: daysAgo(0), category: "Communication", text: "Terse style",
  } as PreferenceEntry);
  brain.contexts.push({
    id: "c1", type: "context", created: daysAgo(0), project: "test", path: "/tmp", content: "Test project context",
  } as ContextEntry);
  brain.learnings.push({
    id: "l1", type: "learning", created: daysAgo(0), text: "Use pnpm",
  } as LearningEntry);

  const result = buildBrainPrompt(brain, "/tmp");

  const behaviorIdx = result.indexOf("Behavior");
  const prefsIdx = result.indexOf("Preferences");
  const contextIdx = result.indexOf("Project");
  const learningsIdx = result.indexOf("Learnings");

  assert(behaviorIdx >= 0, "behavior section present");
  assert(prefsIdx >= 0, "preferences section present");
  assert(contextIdx >= 0, "context section present");
  assert(learningsIdx >= 0, "learnings section present");
  assert(behaviorIdx < prefsIdx, "behavior before preferences");
  assert(prefsIdx < contextIdx, "preferences before context");
  assert(contextIdx < learningsIdx, "context before learnings");
}

console.log("\n--- learning ranking: recency ---");
{
  const brain = emptyBrain();
  brain.learnings.push({
    id: "old", type: "learning", created: daysAgo(60), text: "Old learning",
  } as LearningEntry);
  brain.learnings.push({
    id: "new", type: "learning", created: daysAgo(1), text: "New learning",
  } as LearningEntry);

  const result = buildBrainPrompt(brain, "/tmp");
  const oldIdx = result.indexOf("Old learning");
  const newIdx = result.indexOf("New learning");
  assert(oldIdx >= 0 && newIdx >= 0, "both learnings present");
  assert(newIdx < oldIdx, "newer learning appears first");
}

console.log("\n--- learning ranking: project scope ---");
{
  const brain = emptyBrain();
  brain.learnings.push({
    id: "global", type: "learning", created: daysAgo(1), text: "Global learning",
    scope: "global",
  } as LearningEntry);
  brain.learnings.push({
    id: "scoped", type: "learning", created: daysAgo(1), text: "Scoped learning",
    scope: "project", projectPath: "/my/project",
  } as LearningEntry);

  const result = buildBrainPrompt(brain, "/my/project/src");
  const globalIdx = result.indexOf("Global learning");
  const scopedIdx = result.indexOf("Scoped learning");
  assert(globalIdx >= 0 && scopedIdx >= 0, "both learnings present");
  assert(scopedIdx < globalIdx, "project-scoped learning appears first");
}

console.log("\n--- learning ranking: manual > auto ---");
{
  const brain = emptyBrain();
  brain.learnings.push({
    id: "auto", type: "learning", created: daysAgo(1), text: "Auto learning",
    source: "auto",
  } as LearningEntry);
  brain.learnings.push({
    id: "manual", type: "learning", created: daysAgo(1), text: "Manual learning",
    source: "manual",
  } as LearningEntry);

  const result = buildBrainPrompt(brain, "/tmp");
  const autoIdx = result.indexOf("Auto learning");
  const manualIdx = result.indexOf("Manual learning");
  assert(autoIdx >= 0 && manualIdx >= 0, "both learnings present");
  assert(manualIdx < autoIdx, "manual learning appears first");
}

console.log("\n--- context matching: longest prefix wins ---");
{
  const brain = emptyBrain();
  brain.contexts.push({
    id: "c1", type: "context", created: daysAgo(0), project: "short", path: "/foo", content: "Short context",
  } as ContextEntry);
  brain.contexts.push({
    id: "c2", type: "context", created: daysAgo(0), project: "long", path: "/foo/bar", content: "Long context",
  } as ContextEntry);

  const result = buildBrainPrompt(brain, "/foo/bar/baz");
  assert(result.includes("Long context"), "longest prefix match selected");
  assert(!result.includes("Short context"), "shorter prefix not included");
}

console.log("\n--- context matching: no match ---");
{
  const brain = emptyBrain();
  brain.contexts.push({
    id: "c1", type: "context", created: daysAgo(0), project: "other", path: "/other/project", content: "Other context",
  } as ContextEntry);
  brain.learnings.push({
    id: "l1", type: "learning", created: daysAgo(0), text: "Some learning",
  } as LearningEntry);

  const result = buildBrainPrompt(brain, "/my/project");
  assert(!result.includes("Other context"), "non-matching context excluded");
  assert(!result.includes("Project"), "no project section header when no match");
}

console.log("\n--- budget overflow truncation ---");
{
  const brain = emptyBrain();
  for (let i = 0; i < 100; i++) {
    brain.learnings.push({
      id: `l${i}`,
      type: "learning",
      created: daysAgo(i),
      text: `Learning ${i}: detailed information that uses tokens`,
    } as LearningEntry);
  }
  const result = buildBrainPrompt(brain, "/tmp", { promptBudget: 300 });
  assert(result.includes("…"), "truncation indicator present");
}

console.log("\n--- surplus rolls into learnings ---");
{
  // Tiny behavior section → learnings should get more space
  const brain = emptyBrain();
  brain.behaviors.push({
    id: "b1", type: "behavior", created: daysAgo(0), category: "do", text: "Ok",
  } as BehaviorEntry);
  for (let i = 0; i < 50; i++) {
    brain.learnings.push({
      id: `l${i}`,
      type: "learning",
      created: daysAgo(i),
      text: `Learning ${i}: useful info`,
    } as LearningEntry);
  }

  const resultSmallBehavior = buildBrainPrompt(brain, "/tmp", { promptBudget: 1000 });
  // Count learning lines
  const learningLines = resultSmallBehavior.split("\n").filter(l => l.startsWith("- ")).length;
  assert(learningLines > 5, `surplus budget → more learnings rendered: got ${learningLines}`);
}

console.log("\n--- configurable budget: 500 < 2000 ---");
{
  const brain = emptyBrain();
  for (let i = 0; i < 100; i++) {
    brain.learnings.push({
      id: `l${i}`,
      type: "learning",
      created: daysAgo(i),
      text: `Learning ${i}: content for budget comparison test`,
    } as LearningEntry);
  }

  const small = buildBrainPrompt(brain, "/tmp", { promptBudget: 500 });
  const large = buildBrainPrompt(brain, "/tmp", { promptBudget: 2000 });
  assert(small.length < large.length, `budget 500 (${small.length} chars) < budget 2000 (${large.length} chars)`);
}

// ── Summary ───────────────────────────────────────────────────────

console.log(`\n--- Results: ${PASS} passed, ${FAIL} failed ---`);
process.exit(FAIL > 0 ? 1 : 0);
