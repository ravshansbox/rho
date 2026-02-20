import path from "node:path";
import { pathToFileURL } from "node:url";

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
	if (Object.is(actual, expected)) {
		console.log(`  PASS: ${label}`);
		PASS++;
		return;
	}
	console.error(
		`  FAIL: ${label} (expected ${String(expected)}, got ${String(actual)})`,
	);
	FAIL++;
}

console.log("\n=== Web Chat Session Ordering + Unread Tests ===\n");

const importDir = import.meta.dirname;
if (!importDir) {
	throw new Error("import.meta.dirname is unavailable");
}

const orderingPath = path.resolve(
	importDir,
	"../web/public/js/chat/session-list-ordering.js",
);
const ordering = await import(
	`${pathToFileURL(orderingPath).href}?session-ordering=${Date.now()}`
);

const lifecyclePath = path.resolve(
	importDir,
	"../web/public/js/chat/rpc-session-routing.js",
);
const lifecycle = await import(
	`${pathToFileURL(lifecyclePath).href}?session-ordering-lifecycle=${Date.now()}`
);

console.log(
	"-- comparator: streaming > active non-streaming > history, then recency --",
);
{
	const sessions = [
		{
			id: "sess-history-new",
			timestamp: "2026-02-20T11:00:00.000Z",
		},
		{
			id: "sess-active-old",
			timestamp: "2026-02-20T10:00:00.000Z",
		},
		{
			id: "sess-stream",
			timestamp: "2026-02-20T09:00:00.000Z",
		},
		{
			id: "sess-active-new",
			timestamp: "2026-02-20T08:00:00.000Z",
		},
		{
			id: "sess-history-old",
			timestamp: "2026-02-20T07:00:00.000Z",
		},
	];

	const stateById = new Map([
		[
			"sess-stream",
			{
				status: "streaming",
				rpcSessionId: "rpc-stream",
				lastActivityAt: 100,
			},
		],
		[
			"sess-active-old",
			{
				status: "idle",
				rpcSessionId: "rpc-active-old",
				lastActivityAt: 300,
			},
		],
		[
			"sess-active-new",
			{
				status: "starting",
				rpcSessionId: "rpc-active-new",
				lastActivityAt: 500,
			},
		],
	]);

	const ordered = ordering.sortSessionsForSidebar(sessions, stateById);
	const orderedIds = ordered
		.map((session: { id: string }) => session.id)
		.join(",");
	assertEq(
		orderedIds,
		"sess-stream,sess-active-new,sess-active-old,sess-history-new,sess-history-old",
		"comparator enforces required status grouping + recency",
	);
}

console.log("\n-- row metadata reflects unread + status signals --");
{
	const stateById = new Map([
		[
			"sess-active",
			{
				status: "idle",
				rpcSessionId: "rpc-active",
				lastActivityAt: Date.now(),
				unreadMilestone: true,
			},
		],
	]);

	const activeMeta = ordering.getSessionRowMeta(
		{ id: "sess-active", timestamp: "2026-02-20T12:00:00.000Z" },
		stateById,
	);
	assertEq(activeMeta.status, "idle", "metadata uses tracked session status");
	assertEq(
		activeMeta.isActiveRuntime,
		true,
		"metadata marks rpc-bound session as active runtime",
	);
	assertEq(
		activeMeta.unreadMilestone,
		true,
		"metadata carries unread milestone flag",
	);

	const inactiveMeta = ordering.getSessionRowMeta(
		{ id: "sess-history", timestamp: "2026-02-20T12:01:00.000Z" },
		stateById,
	);
	assertEq(
		inactiveMeta.isActiveRuntime,
		false,
		"metadata marks unknown sessions as inactive history",
	);
}

console.log(
	"\n-- unread transitions: milestone only + clear on focused successful resync --",
);
{
	const backgroundState = {
		sessionId: "sess-a",
		rpcSessionId: "rpc-a",
		sessionFile: "/tmp/sess-a.jsonl",
		status: "idle",
		unreadMilestone: false,
		lastActivityAt: 0,
		isStreaming: false,
		isSendingPrompt: false,
		pendingRpcCommands: new Map(),
	};
	const backgroundRoute = {
		sessionId: "sess-a",
		rpcSessionId: "rpc-a",
		state: backgroundState,
		isFocused: false,
	};

	lifecycle.applyRpcLifecycleToSessionState(backgroundRoute, {
		type: "message_update",
	});
	assertEq(
		backgroundState.unreadMilestone,
		false,
		"non-milestone background updates do not set unread",
	);

	lifecycle.applyRpcLifecycleToSessionState(backgroundRoute, {
		type: "agent_end",
	});
	assertEq(
		backgroundState.unreadMilestone,
		true,
		"background agent_end sets milestone unread",
	);

	backgroundState.unreadMilestone = false;
	lifecycle.applyRpcLifecycleToSessionState(backgroundRoute, {
		type: "rpc_error",
		message: "boom",
	});
	assertEq(
		backgroundState.unreadMilestone,
		true,
		"background rpc_error sets milestone unread",
	);

	const focusedState = {
		...backgroundState,
		unreadMilestone: true,
		error: "",
	};
	const focusedRoute = {
		sessionId: "sess-a",
		rpcSessionId: "rpc-a",
		state: focusedState,
		isFocused: true,
	};

	lifecycle.applyRpcLifecycleToSessionState(focusedRoute, {
		type: "message_update",
	});
	assertEq(
		focusedState.unreadMilestone,
		true,
		"focused non-resync events do not clear unread milestone",
	);

	lifecycle.applyRpcLifecycleToSessionState(focusedRoute, {
		type: "response",
		command: "get_state",
		success: true,
		state: { isStreaming: false },
	});
	assertEq(
		focusedState.unreadMilestone,
		false,
		"focused successful get_state resync clears unread milestone",
	);
}

console.log(`\n=== Results: ${PASS} passed, ${FAIL} failed ===\n`);
process.exit(FAIL > 0 ? 1 : 0);
