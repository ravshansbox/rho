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

type Listener = (event?: unknown) => void;

interface ChatVm extends Record<string, unknown> {
	focusedSessionId: string;
	activeSessionId: string;
	sessionStateById: Map<string, Record<string, unknown>>;
	sessions: Array<Record<string, unknown>>;
	promptText: string;
	ensureSessionState: (
		sessionId: string,
		meta?: Record<string, unknown>,
	) => Record<string, unknown> | null;
	startRpcSession: (
		sessionFile: string,
		options?: Record<string, unknown>,
	) => void;
	preparePersistedRestoreSnapshot: (
		hashSessionId?: string,
	) => Record<string, unknown> | null;
	restorePersistedSessionRuntime: (
		snapshot: Record<string, unknown> | null,
	) => Promise<void>;
}

type MockStorage = {
	data: Map<string, string>;
	setCount: () => number;
	storage: {
		getItem: (key: string) => string | null;
		setItem: (key: string, value: string) => void;
		removeItem: (key: string) => void;
	};
};

function createMockStorage(seed: Record<string, string> = {}): MockStorage {
	const data = new Map<string, string>(Object.entries(seed));
	let writes = 0;
	return {
		data,
		setCount: () => writes,
		storage: {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => {
				writes += 1;
				data.set(key, String(value));
			},
			removeItem: (key: string) => {
				data.delete(key);
			},
		},
	};
}

class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readonly url: string;
	readyState = MockWebSocket.CONNECTING;
	private listeners = new Map<string, Array<{ cb: Listener; once: boolean }>>();

	constructor(url: string) {
		this.url = url;
	}

	addEventListener(
		type: string,
		cb: Listener,
		options?: { once?: boolean },
	): void {
		const current = this.listeners.get(type) ?? [];
		current.push({ cb, once: Boolean(options?.once) });
		this.listeners.set(type, current);
	}

	send(_data: string): void {}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadChatVm(
	localStorage: MockStorage["storage"],
): Promise<ChatVm> {
	let factory: (() => Record<string, unknown>) | null = null;
	const listeners = new Map<string, () => void>();
	const globals = globalThis as unknown as Record<string, unknown>;

	globals.document = {
		addEventListener: (type: string, cb: () => void) => {
			listeners.set(type, cb);
		},
		querySelector: () => null,
		querySelectorAll: () => [],
		body: {
			classList: {
				add: () => {},
				toggle: () => {},
				remove: () => {},
			},
		},
		hidden: false,
		title: "",
	};

	globals.window = {
		location: {
			protocol: "http:",
			host: "localhost:3141",
			hash: "",
			pathname: "/",
			search: "",
		},
		addEventListener: () => {},
		removeEventListener: () => {},
	};

	globals.history = { replaceState: () => {} };
	globals.localStorage = localStorage;
	globals.marked = {
		setOptions: () => {},
		parse: (text: string) => text,
	};
	globals.hljs = undefined;
	globals.fetch = async () => ({
		ok: true,
		json: async () => [],
		headers: { get: () => "0" },
	});
	globals.requestAnimationFrame = (cb: () => void) => {
		cb();
		return 0;
	};
	globals.WebSocket = MockWebSocket;
	globals.Alpine = {
		data: (_name: string, fn: () => Record<string, unknown>) => {
			factory = fn;
		},
	};

	const importDir = import.meta.dirname;
	if (!importDir) {
		throw new Error("import.meta.dirname is unavailable");
	}
	const chatPath = path.resolve(importDir, "../web/public/js/chat.js");
	await import(
		`${pathToFileURL(chatPath).href}?restore-integration-test=${Date.now()}`
	);

	const init = listeners.get("alpine:init");
	if (!init) {
		throw new Error("chat.js did not register alpine:init listener");
	}
	init();

	if (!factory) {
		throw new Error("chat.js did not register Alpine.data factory");
	}

	const vm = factory() as ChatVm;
	vm.$refs = { thread: null, composerInput: null };
	vm.$root = null;
	vm.$nextTick = (fn: (() => void) | undefined) => {
		if (typeof fn === "function") {
			fn();
		}
	};
	vm.loadSessions = () => {};
	vm.updateFooter = () => {};
	vm.scrollThreadToBottom = () => {};
	vm.requestState = () => {};
	vm.requestAvailableModels = () => {};
	vm.requestSlashCommands = () => {};

	return vm;
}

console.log("\n=== Web Chat Restore Persistence Tests ===\n");

const importDir = import.meta.dirname;
if (!importDir) {
	throw new Error("import.meta.dirname is unavailable");
}
const persistencePath = path.resolve(
	importDir,
	"../web/public/js/chat/session-restore-persistence.js",
);
const persistenceModule = await import(
	`${pathToFileURL(persistencePath).href}?restore-unit-test=${Date.now()}`
);
const {
	SESSION_RESTORE_STORAGE_KEY,
	buildPersistedRestorePayload,
	parsePersistedRestorePayload,
} = persistenceModule;

console.log("-- persistence payload serialization + migration guards --");
{
	const payload = buildPersistedRestorePayload(
		{
			focusedSessionId: "sess-b",
			sessionStateById: new Map([
				[
					"sess-a",
					{
						rpcSessionId: "rpc-a",
						status: "idle",
						isStreaming: false,
						isSendingPrompt: false,
						pendingRpcCommands: new Map(),
						promptText: "draft a",
					},
				],
				[
					"sess-b",
					{
						rpcSessionId: "",
						status: "idle",
						isStreaming: false,
						isSendingPrompt: false,
						pendingRpcCommands: new Map(),
						promptText: "draft b",
					},
				],
				[
					"sess-c",
					{
						rpcSessionId: "",
						status: "starting",
						isStreaming: false,
						isSendingPrompt: false,
						pendingRpcCommands: new Map(),
						promptText: "",
					},
				],
			]),
		},
		12345,
	);

	assertEq(payload.version, 1, "serializer writes schema version 1");
	assertEq(
		payload.focusedSessionId,
		"sess-b",
		"serializer writes focused session id",
	);
	assertEq(payload.savedAt, 12345, "serializer includes saved timestamp");
	assertEq(
		payload.activeSessionIds.join(","),
		"sess-a,sess-c",
		"serializer writes active runtime session ids",
	);
	assertEq(
		payload.drafts["sess-a"],
		"draft a",
		"serializer stores session drafts",
	);
	assertEq(
		payload.drafts["sess-b"],
		"draft b",
		"serializer stores non-active session drafts",
	);
	assertEq(
		Object.hasOwn(payload.drafts, "sess-c"),
		false,
		"serializer omits empty drafts",
	);

	const parsed = parsePersistedRestorePayload(JSON.stringify(payload));
	assertEq(parsed?.version, 1, "parser reads valid payload");
	assertEq(
		parsed?.activeSessionIds.join(","),
		"sess-a,sess-c",
		"parser preserves active session order",
	);
	assertEq(parsed?.drafts["sess-b"], "draft b", "parser preserves draft map");
	assertEq(
		parsePersistedRestorePayload('{"version":2}'),
		null,
		"parser rejects unsupported versions",
	);
	assertEq(
		parsePersistedRestorePayload('{"version":1,"activeSessionIds":"oops"}'),
		null,
		"parser rejects malformed activeSessionIds shape",
	);
	assertEq(
		parsePersistedRestorePayload("not json"),
		null,
		"parser rejects invalid JSON",
	);
}

console.log(
	"\n-- focus persists immediately and drafts flush with debounce --",
);
{
	const storage = createMockStorage();
	const chat = await loadChatVm(storage.storage);

	chat.activeSessionId = "sess-focus";
	const afterFocus = parsePersistedRestorePayload(
		storage.data.get(SESSION_RESTORE_STORAGE_KEY) ?? null,
	);
	assertEq(
		afterFocus?.focusedSessionId,
		"sess-focus",
		"focus change persists immediately",
	);

	chat.promptText = "draft one";
	chat.promptText = "draft two";

	const immediate = parsePersistedRestorePayload(
		storage.data.get(SESSION_RESTORE_STORAGE_KEY) ?? null,
	);
	assertEq(
		immediate?.drafts?.["sess-focus"] ?? "",
		"",
		"draft changes are not flushed before debounce window",
	);

	await wait(260);
	const afterDraftFlush = parsePersistedRestorePayload(
		storage.data.get(SESSION_RESTORE_STORAGE_KEY) ?? null,
	);
	assertEq(
		afterDraftFlush?.drafts?.["sess-focus"],
		"draft two",
		"debounced draft flush persists latest draft",
	);
	assert(storage.setCount() >= 2, "storage receives focus + draft writes");
}

console.log("\n-- restore runtime isolates failed sessions and continues --");
{
	const snapshot = {
		version: 1,
		focusedSessionId: "sess-ok",
		activeSessionIds: ["sess-ok", "sess-fail"],
		drafts: {
			"sess-ok": "draft ok",
			"sess-fail": "draft fail",
		},
		savedAt: Date.now(),
	};
	const storage = createMockStorage({
		[SESSION_RESTORE_STORAGE_KEY]: JSON.stringify(snapshot),
	});
	const chat = await loadChatVm(storage.storage);
	chat.sessions = [
		{
			id: "sess-ok",
			file: "/tmp/sess-ok.jsonl",
			timestamp: "2026-02-20T00:00:00.000Z",
			messageCount: 0,
		},
	];

	const started: Array<{ sessionId: string; sessionFile: string }> = [];
	chat.startRpcSession = (
		sessionFile: string,
		options: Record<string, unknown> = {},
	) => {
		started.push({
			sessionId: typeof options.sessionId === "string" ? options.sessionId : "",
			sessionFile,
		});
		const state = chat.ensureSessionState(
			typeof options.sessionId === "string"
				? options.sessionId
				: chat.focusedSessionId,
			{ sessionFile },
		);
		if (state) {
			state.status = "starting";
		}
	};

	const globals = globalThis as unknown as Record<string, unknown>;
	globals.fetch = async (url: unknown) => {
		if (url === "/api/sessions/sess-fail") {
			return {
				ok: false,
				status: 404,
				json: async () => ({ error: "Session not found" }),
				headers: { get: () => "0" },
			};
		}
		return {
			ok: true,
			json: async () => [],
			headers: { get: () => "0" },
		};
	};

	const prepared = chat.preparePersistedRestoreSnapshot("");
	await chat.restorePersistedSessionRuntime(prepared);

	assertEq(
		chat.activeSessionId,
		"sess-ok",
		"restore preparation applies focused session from persisted snapshot",
	);
	assertEq(
		chat.sessionStateById.get("sess-ok")?.promptText,
		"draft ok",
		"restore hydrates successful session draft",
	);
	assertEq(
		chat.sessionStateById.get("sess-fail")?.promptText,
		"draft fail",
		"restore hydrates failed session draft before erroring",
	);
	assertEq(
		started.length,
		1,
		"restore continues and starts sessions that can be resolved",
	);
	assertEq(
		started[0]?.sessionId,
		"sess-ok",
		"restore starts runtime using persisted active session id",
	);
	assertEq(
		started[0]?.sessionFile,
		"/tmp/sess-ok.jsonl",
		"restore starts runtime with resolved session file",
	);
	assertEq(
		chat.sessionStateById.get("sess-fail")?.status,
		"error",
		"failed restore session is marked error without aborting others",
	);
	assert(
		String(chat.sessionStateById.get("sess-fail")?.error ?? "").includes(
			"Session not found",
		),
		"failed restore session surfaces lightweight error context",
	);
}

console.log(`\n=== Results: ${PASS} passed, ${FAIL} failed ===\n`);
process.exit(FAIL > 0 ? 1 : 0);
