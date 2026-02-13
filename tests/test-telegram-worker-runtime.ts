/**
 * Tests for telegram worker runtime.
 * Run: npx tsx tests/test-telegram-worker-runtime.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createTelegramWorkerRuntime } from "../extensions/telegram/worker-runtime.ts";
import { requestTelegramCheckTrigger } from "../extensions/telegram/check-trigger.ts";
import type { TelegramSettings } from "../extensions/telegram/lib.ts";

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

console.log("\n=== Telegram worker runtime tests ===\n");

const tmp = mkdtempSync(join(tmpdir(), "rho-telegram-worker-runtime-"));
try {
  const statePath = join(tmp, "telegram", "state.json");
  const mapPath = join(tmp, "telegram", "session-map.json");
  const sessionDir = join(tmp, "sessions");
  const triggerPath = join(tmp, "telegram", "check.trigger.json");
  const logPath = join(tmp, "telegram", "log.jsonl");

  const updates = [
    {
      update_id: 501,
      message: {
        message_id: 77,
        from: { id: 2222 },
        chat: { id: 1111, type: "private" as const },
        date: 1,
        text: "hello worker",
      },
    },
  ];

  let getUpdatesCalls = 0;
  const sent: Array<{ chat_id: number; text: string }> = [];

  const client = {
    async getUpdates() {
      getUpdatesCalls++;
      return updates;
    },
    async sendMessage(params: { chat_id: number; text: string }) {
      sent.push({ chat_id: params.chat_id, text: params.text });
      return { message_id: 1, chat: { id: params.chat_id, type: "private" as const }, date: 1 };
    },
    async sendChatAction() {
      return true;
    },
  };

  const rpcRunner = {
    async runPrompt() {
      return "pong";
    },
    dispose() {
      // no-op
    },
  };

  const settings: TelegramSettings = {
    enabled: true,
    mode: "polling",
    botTokenEnv: "TELEGRAM_BOT_TOKEN",
    pollTimeoutSeconds: 1,
    allowedChatIds: [1111],
    allowedUserIds: [2222],
    requireMentionInGroups: false,
  };

  const runtime = createTelegramWorkerRuntime({
    settings,
    client: client as any,
    rpcRunner: rpcRunner as any,
    statePath,
    mapPath,
    sessionDir,
    checkTriggerPath: triggerPath,
    operatorConfigPath: join(tmp, "telegram", "config.json"),
    botUsername: "",
    logPath,
  });

  console.log("-- pollOnce processes update + reply --");
  const result = await runtime.pollOnce(false);
  assert(result.ok === true, "pollOnce reports ok");
  assert(result.accepted === 1, "pollOnce accepts authorized update");
  assert(sent.length === 1, "pollOnce sends outbound reply");

  const snapshot = runtime.getSnapshot();
  assert(snapshot.runtimeState.last_update_id === 502, "runtime state advances update offset");
  assert(snapshot.pendingInbound === 0, "inbound queue drained");
  assert(snapshot.pendingOutbound === 0, "outbound queue drained");

  console.log("\n-- check trigger consumes + runs poll --");
  requestTelegramCheckTrigger(triggerPath, {
    requestedAt: Date.now(),
    requesterPid: 9000,
    requesterRole: "follower",
    source: "test",
  });

  const check = await runtime.handleCheckTrigger();
  assert(check.triggered === true, "check trigger consumed");
  assert(getUpdatesCalls === 2, "check trigger runs pollOnce");

  runtime.dispose();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== Results: ${PASS} passed, ${FAIL} failed ===`);
process.exit(FAIL > 0 ? 1 : 0);
