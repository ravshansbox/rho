/**
 * Tests for extensions/agent-sop — parameter resolution, escaping, and enum parsing.
 * Run: npx tsx tests/test-agent-sop.ts
 */

import { resolveParamValues, escapeRegExp } from "../extensions/agent-sop/index.ts";
import { parseSOP } from "../extensions/agent-sop/parser.ts";
import * as fs from "node:fs";

// ---- Test harness ----
let PASS = 0;
let FAIL = 0;

function assert(condition: boolean, label: string): void {
	if (condition) {
		PASS++;
		console.log(`  ✅ ${label}`);
	} else {
		FAIL++;
		console.error(`  ❌ ${label}`);
	}
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		PASS++;
		console.log(`  ✅ ${label}`);
	} else {
		FAIL++;
		console.error(`  ❌ ${label}\n     expected: ${e}\n     actual:   ${a}`);
	}
}

// ---- escapeRegExp ----
console.log("\n── escapeRegExp ──");

assertEq(escapeRegExp("project_name"), "project_name", "plain name unchanged");
assertEq(escapeRegExp("my.param"), "my\\.param", "dot escaped");
assertEq(escapeRegExp("price$5"), "price\\$5", "dollar escaped");
assertEq(escapeRegExp("a(b)c"), "a\\(b\\)c", "parens escaped");
assertEq(escapeRegExp(""), "", "empty string");

// ---- resolveParamValues ----
console.log("\n── resolveParamValues ──");

assertEq(
	resolveParamValues({ a: "hello", b: "world" }),
	{ a: "hello", b: "world" },
	"no cross-refs — unchanged",
);

assertEq(
	resolveParamValues({ name: "foo", dir: "path/{name}" }),
	{ name: "foo", dir: "path/foo" },
	"single cross-ref resolved",
);

assertEq(
	resolveParamValues({ a: "x", b: "{a}-y", c: "{b}-z" }),
	{ a: "x", b: "x-y", c: "x-y-z" },
	"transitive refs resolved",
);

assertEq(
	resolveParamValues({ a: "{a}-loop" }),
	{ a: "{a}-loop" },
	"self-ref skipped",
);

assertEq(
	resolveParamValues({ a: "{unknown}" }),
	{ a: "{unknown}" },
	"unknown ref unchanged",
);

assertEq(
	resolveParamValues({}),
	{},
	"empty input → empty output",
);

// PDD scenario
assertEq(
	resolveParamValues({
		rough_idea: "test idea",
		project_name: "my-project",
		project_dir: ".agents/planning/{project_name}",
	}),
	{
		rough_idea: "test idea",
		project_name: "my-project",
		project_dir: ".agents/planning/my-project",
	},
	"PDD cross-ref: project_dir resolves project_name",
);

// Multiple refs in one value
assertEq(
	resolveParamValues({ a: "x", b: "y", c: "{a}/{b}" }),
	{ a: "x", b: "y", c: "x/y" },
	"multiple refs in one value",
);

// ---- Dollar-safe replacement ----
console.log("\n── Dollar-safe replacement ──");

{
	const params = resolveParamValues({
		project_name: "$HOME/special",
		project_dir: ".agents/{project_name}",
	});
	let content = "dir: {project_dir} name: {project_name}";
	for (const [key, value] of Object.entries(params)) {
		content = content.replace(
			new RegExp(`\\{${escapeRegExp(key)}\\}`, "g"),
			() => value,
		);
	}
	assert(content.includes("$HOME/special"), "dollar sign preserved in replacement");
	assertEq(content, "dir: .agents/$HOME/special name: $HOME/special", "full dollar-safe output");
}

{
	const params = { price: "$5" };
	let content = "Cost: {price}";
	for (const [key, value] of Object.entries(params)) {
		content = content.replace(
			new RegExp(`\\{${escapeRegExp(key)}\\}`, "g"),
			() => value,
		);
	}
	assertEq(content, "Cost: $5", "$5 literal preserved");
}

// ---- Enum option parsing ----
console.log("\n── Enum option parsing ──");

{
	const sop = parseSOP(
		`# Test SOP

## Overview

A test SOP.

## Parameters

- **mode** (optional, default: "auto"): The interaction mode:
  - "interactive": With confirmation
  - "auto": No interaction

- **name** (required): A plain param

## Steps

### 1. Do something

Do the thing.
`,
		"test.sop.md",
	);

	const modeParam = sop.parameters.find((p) => p.name === "mode");
	assertEq(modeParam?.options, ["interactive", "auto"], "mode param has options");

	const nameParam = sop.parameters.find((p) => p.name === "name");
	assertEq(nameParam?.options, undefined, "plain param has no options");
}

// Options without descriptions
{
	const sop = parseSOP(
		`# Test

## Overview

Test.

## Parameters

- **level** (optional, default: "info"): Log level:
  - "debug"
  - "info"
  - "warn"

## Steps

### 1. Step

Step.
`,
		"test2.sop.md",
	);

	const levelParam = sop.parameters.find((p) => p.name === "level");
	assertEq(levelParam?.options, ["debug", "info", "warn"], "options without descriptions parsed");
}

// Real SOP file: code-assist
{
	const content = fs.readFileSync("sops/code-assist.sop.md", "utf-8");
	const sop = parseSOP(content, "sops/code-assist.sop.md");
	const modeParam = sop.parameters.find((p) => p.name === "mode");
	assertEq(modeParam?.options, ["interactive", "auto"], "code-assist mode options from real file");

	const taskParam = sop.parameters.find((p) => p.name === "task_description");
	assertEq(taskParam?.options, undefined, "task_description has no options");
}

// ---- End-to-end: PDD SOP ----
console.log("\n── End-to-end: PDD SOP ──");

{
	const content = fs.readFileSync("sops/pdd.sop.md", "utf-8");
	const sop = parseSOP(content, "sops/pdd.sop.md");

	const params: Record<string, string> = {
		project_name: "test-proj",
		project_dir: ".agents/planning/{project_name}",
	};

	const resolved = resolveParamValues(params);
	let sopContent = sop.rawContent;
	for (const [key, value] of Object.entries(resolved)) {
		sopContent = sopContent.replace(
			new RegExp(`\\{${escapeRegExp(key)}\\}`, "g"),
			() => value,
		);
	}

	const remaining = sopContent.match(/\{(project_name|project_dir)\}/g);
	assert(remaining === null, "no project_name or project_dir placeholders remain");
	assert(sopContent.includes(".agents/planning/test-proj/"), "resolved path present in output");
	assert(!sopContent.includes(".agents/planning/{project_name}"), "no unresolved default in output");
}

// ---- Summary ----
console.log(`\n── Results: ${PASS} passed, ${FAIL} failed ──`);
if (FAIL > 0) process.exit(1);
