/**
 * Tests for cli/index.ts command router.
 *
 * NOTE: these tests must NOT start daemons or mutate user config.
 * We only call `--help` / `--version` and check basic routing.
 *
 * Run: node --experimental-strip-types tests/test-cli.ts
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

// ---- Test harness ----
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

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    console.log(`  PASS: ${label}`);
    PASS++;
  } else {
    console.error(`  FAIL: ${label} -- "${needle}" not found in output`);
    FAIL++;
  }
}

function assertNotIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    console.log(`  PASS: ${label}`);
    PASS++;
  } else {
    console.error(`  FAIL: ${label} -- "${needle}" should not appear in output`);
    FAIL++;
  }
}

const CLI_PATH = path.resolve(import.meta.dirname!, "../cli/index.ts");

function run(args: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node --experimental-strip-types ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", code: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: e.status ?? 1,
    };
  }
}

console.log("\n=== CLI Router Tests ===\n");

// -- --help flag --
console.log("-- --help --");
{
  const r = run("--help");
  assert(r.code === 0, "--help exits 0");
  assertIncludes(r.stdout, "rho", "--help mentions rho");
  for (const cmd of ["init", "sync", "doctor", "upgrade", "start", "stop", "status", "trigger", "logs", "login", "telegram", "skills"]) {
    assertIncludes(r.stdout, cmd, `--help lists ${cmd}`);
  }
}

// -- no args runs start (not help) --
// Bare `rho` dispatches to `start --foreground`. In a test environment without
// tmux, this may fail — that's expected. We just verify it doesn't show help.
console.log("\n-- no args --");
{
  const r = run("");
  // Start may fail without tmux, but it should NOT show the help text.
  assert(!r.stdout.includes("Commands:"), "no args dispatches to start (not help)");
}

// -- --version flag --
console.log("\n-- --version --");
{
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname!, "../package.json"), "utf-8"));
  const r = run("--version");
  assert(r.code === 0, "--version exits 0");
  assertIncludes(r.stdout, pkg.version, "--version shows package version");
}

// -- unknown command --
console.log("\n-- unknown command --");
{
  const r = run("nonexistent");
  assert(r.code !== 0, "unknown command exits non-zero");
  assertIncludes(r.stderr || r.stdout, "nonexistent", "unknown command mentions the bad command");
}

// -- each command supports --help without routing failure --
console.log("\n-- subcommand --help --");
{
  for (const cmd of ["init", "sync", "doctor", "upgrade", "start", "stop", "status", "trigger", "logs", "login", "telegram", "skills"]) {
    const r = run(`${cmd} --help`);
    assertNotIncludes(r.stderr, "Unknown command", `${cmd} --help routes`);
  }
}

// ---- smol-toml dependency check ----
console.log("\n-- smol-toml available --");
{
  try {
    const toml = await import("smol-toml");
    assert(typeof toml.parse === "function", "smol-toml parse is available");
    const parsed = toml.parse("[test]\nval = 42");
    assert((parsed as any).test.val === 42, "smol-toml parses TOML correctly");
  } catch {
    assert(false, "smol-toml is importable");
    assert(false, "smol-toml parses TOML correctly");
  }
}

console.log(`\n=== Results: ${PASS} passed, ${FAIL} failed ===\n`);
process.exit(FAIL > 0 ? 1 : 0);
