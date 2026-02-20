import { type ActiveSession, rpcManager } from "../web/rpc-manager.ts";
import app from "../web/server.ts";

let PASS = 0;
let FAIL = 0;

function assert(condition: boolean, label: string): void {
	if (condition) {
		console.log(`  PASS: ${label}`);
		PASS++;
		return;
	}
	console.error(`  FAIL: ${label}`);
	FAIL++;
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  PASS: ${label}`);
		PASS++;
		return;
	}
	console.error(`  FAIL: ${label} (expected ${e}, got ${a})`);
	FAIL++;
}

console.log("\n=== Web RPC Sessions API Tests ===\n");

console.log("-- active sessions route returns manager metadata --");
{
	const fakeSessions: ActiveSession[] = [
		{
			id: "rpc-a",
			sessionFile: "/tmp/a.jsonl",
			startedAt: "2026-02-20T17:00:00.000Z",
			lastActivityAt: "2026-02-20T17:00:30.000Z",
			pid: 1234,
		},
		{
			id: "rpc-b",
			sessionFile: "/tmp/b.jsonl",
			startedAt: "2026-02-20T17:01:00.000Z",
			lastActivityAt: "2026-02-20T17:01:30.000Z",
			pid: null,
		},
	];
	const originalGetActiveSessions = rpcManager.getActiveSessions;
	rpcManager.getActiveSessions = () => fakeSessions;

	try {
		const response = await app.fetch(
			new Request("http://localhost/api/rpc/sessions"),
		);
		assertEq(response.status, 200, "GET /api/rpc/sessions returns 200");
		if (response.status === 200) {
			const body = (await response.json()) as ActiveSession[];
			assert(Array.isArray(body), "response body is an array");
			assertEq(
				body,
				fakeSessions,
				"response returns rpcManager.getActiveSessions() payload",
			);
		}
	} finally {
		rpcManager.getActiveSessions = originalGetActiveSessions;
	}
}

console.log("\n-- active sessions route handles manager exceptions --");
{
	const originalGetActiveSessions = rpcManager.getActiveSessions;
	rpcManager.getActiveSessions = () => {
		throw new Error("simulated rpc sessions failure");
	};

	try {
		const response = await app.fetch(
			new Request("http://localhost/api/rpc/sessions"),
		);
		assertEq(
			response.status,
			500,
			"GET /api/rpc/sessions returns 500 on manager error",
		);
		if (response.status === 500) {
			const body = (await response.json()) as { error?: string };
			assertEq(
				body.error,
				"simulated rpc sessions failure",
				"error payload surfaces manager failure reason",
			);
		}
	} finally {
		rpcManager.getActiveSessions = originalGetActiveSessions;
	}
}

console.log(`\n=== Results: ${PASS} passed, ${FAIL} failed ===\n`);
process.exit(FAIL > 0 ? 1 : 0);
