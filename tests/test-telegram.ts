/**
 * Tests for telegram extension helper library + API client.
 * Run: npx tsx tests/test-telegram.ts
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import {
  readTelegramSettings,
  loadRuntimeState,
  saveRuntimeState,
  advanceUpdateOffset,
  type TelegramSettings,
} from "../extensions/telegram/lib.ts";
import { TelegramClient, TelegramApiError } from "../extensions/telegram/api.ts";
import { authorizeInbound, normalizeInboundUpdate } from "../extensions/telegram/router.ts";
import { loadSessionMap, resolveSessionFile, sessionKeyForEnvelope } from "../extensions/telegram/session-map.ts";
import { TelegramRpcRunner } from "../extensions/telegram/rpc.ts";
import { chunkTelegramText, renderOutboundText } from "../extensions/telegram/outbound.ts";
import { retryDelayMs, shouldRetryTelegramError } from "../extensions/telegram/retry.ts";
import { appendTelegramLog } from "../extensions/telegram/log.ts";
import { loadOperatorConfig, saveOperatorConfig } from "../extensions/telegram/operator-config.ts";
import {
  createTelegramPollLeadershipState,
  releaseTelegramPollLeadership,
  stepTelegramPollLeadership,
} from "../extensions/telegram/poll-leadership.ts";

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

console.log("\n=== Telegram helper tests ===\n");

const tmp = mkdtempSync(join(tmpdir(), "rho-telegram-test-"));
try {
  console.log("-- readTelegramSettings defaults --");
  {
    const settings = readTelegramSettings(join(tmp, "missing.toml"));
    assert(settings.enabled === false, "enabled defaults false");
    assert(settings.mode === "polling", "mode defaults polling");
    assert(settings.botTokenEnv === "TELEGRAM_BOT_TOKEN", "default token env");
    assert(settings.pollTimeoutSeconds === 30, "default poll timeout");
    assert(settings.requireMentionInGroups === true, "default group mention requirement");
  }

  console.log("\n-- readTelegramSettings parse values --");
  {
    const initPath = join(tmp, "init.toml");
    writeFileSync(
      initPath,
      [
        "[settings.telegram]",
        "enabled = true",
        "mode = \"webhook\"",
        "bot_token_env = \"TG_BOT\"",
        "poll_timeout_seconds = 45",
        "allowed_chat_ids = [123, 456]",
        "allowed_user_ids = [42]",
        "require_mention_in_groups = false",
      ].join("\n")
    );

    const settings = readTelegramSettings(initPath);
    assert(settings.enabled === true, "enabled parsed");
    assert(settings.mode === "webhook", "mode parsed");
    assert(settings.botTokenEnv === "TG_BOT", "token env parsed");
    assert(settings.pollTimeoutSeconds === 45, "poll timeout parsed");
    assert(settings.allowedChatIds.length === 2, "chat ids parsed");
    assert(settings.allowedUserIds.length === 1, "user ids parsed");
    assert(settings.requireMentionInGroups === false, "group mention flag parsed");
  }

  console.log("\n-- runtime state read/write --");
  {
    const statePath = join(tmp, "telegram", "state.json");
    const state = loadRuntimeState(statePath);
    assert(existsSync(statePath), "state file created");
    assert(state.last_update_id === 0, "default last_update_id");
    assert(state.mode === "polling", "default mode polling");

    saveRuntimeState({ ...state, last_update_id: 10, consecutive_failures: 1 }, statePath);
    const saved = JSON.parse(readFileSync(statePath, "utf-8")) as any;
    assert(saved.last_update_id === 10, "state write persisted");
    assert(saved.consecutive_failures === 1, "state failure counter persisted");
  }

  console.log("\n-- loadRuntimeState parse existing --");
  {
    const statePath = join(tmp, "telegram", "state.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        last_update_id: 99,
        last_poll_at: "2026-02-13T00:00:00.000Z",
        consecutive_failures: 2,
        mode: "webhook",
      })
    );
    const state = loadRuntimeState(statePath);
    assert(state.last_update_id === 99, "existing last_update_id parsed");
    assert(state.last_poll_at === "2026-02-13T00:00:00.000Z", "existing last_poll_at parsed");
    assert(state.consecutive_failures === 2, "existing consecutive_failures parsed");
    assert(state.mode === "webhook", "existing mode parsed");
  }

  console.log("\n-- advanceUpdateOffset --");
  {
    assert(advanceUpdateOffset(0, []) === 0, "empty updates keep current offset");
    assert(advanceUpdateOffset(10, [5, 7]) === 10, "older updates do not move offset backward");
    assert(advanceUpdateOffset(10, [10, 11]) === 12, "offset advances to max+1");
    assert(advanceUpdateOffset(0, [1, 3, 2]) === 4, "out-of-order ids use max+1");
  }

  console.log("\n-- TelegramClient mocked API --");
  {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (_url: string, _init?: any) => {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              result: [{ update_id: 1 }, { update_id: 2 }],
            };
          },
        } as any;
      }) as any;

      const client = new TelegramClient("test-token", "https://example.test");
      const updates = await client.getUpdates({ offset: 0, timeout: 1 });
      assert(updates.length === 2, "getUpdates returns mocked updates");

      globalThis.fetch = (async (_url: string, _init?: any) => {
        return {
          ok: false,
          status: 429,
          async json() {
            return {
              ok: false,
              description: "Too Many Requests",
              parameters: { retry_after: 2 },
            };
          },
        } as any;
      }) as any;

      let gotRateLimit = false;
      try {
        await client.sendMessage({ chat_id: 1, text: "hi" });
      } catch (error) {
        gotRateLimit = error instanceof TelegramApiError && error.retryAfterSeconds === 2;
      }
      assert(gotRateLimit, "sendMessage surfaces retry_after on 429");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  console.log("\n-- normalize + authz gates --");
  {
    const update = {
      update_id: 123,
      message: {
        message_id: 9,
        from: { id: 42 },
        chat: { id: 777, type: "private" as const },
        date: 1,
        text: "hello",
      },
    };

    const normalized = normalizeInboundUpdate(update);
    assert(normalized !== null, "normalizes message update");
    assert(normalized?.chatId === 777, "normalized chat id");
    assert(normalized?.userId === 42, "normalized user id");

    const settings: TelegramSettings = {
      enabled: true,
      mode: "polling",
      botTokenEnv: "TELEGRAM_BOT_TOKEN",
      pollTimeoutSeconds: 30,
      allowedChatIds: [777],
      allowedUserIds: [42],
      requireMentionInGroups: true,
    };

    const authOk = authorizeInbound(normalized!, settings);
    assert(authOk.ok === true, "allowlisted private message authorized");

    const blockedChat = authorizeInbound(normalized!, { ...settings, allowedChatIds: [1] });
    assert(blockedChat.ok === false && blockedChat.reason === "chat_not_allowed", "blocks unknown chat");

    const blockedUser = authorizeInbound(normalized!, { ...settings, allowedUserIds: [99] });
    assert(blockedUser.ok === false && blockedUser.reason === "user_not_allowed", "blocks unknown user");

    const groupEnvelope = normalizeInboundUpdate({
      update_id: 124,
      message: {
        message_id: 10,
        from: { id: 42 },
        chat: { id: -100, type: "group" },
        date: 1,
        text: "random group message",
      },
    });

    const blockedGroup = authorizeInbound(groupEnvelope!, { ...settings, allowedChatIds: [-100] });
    assert(blockedGroup.ok === false && blockedGroup.reason === "group_not_activated", "blocks non-activated group message");

    const activatedGroup = authorizeInbound(
      { ...groupEnvelope!, text: "@rho-bot hi" },
      { ...settings, allowedChatIds: [-100] },
      "rho-bot",
    );
    assert(activatedGroup.ok === true, "allows mentioned group message");
  }

  console.log("\n-- deterministic session mapping --");
  {
    const mapPath = join(tmp, "telegram", "session-map.json");
    const sessionDir = join(tmp, "sessions");
    const dmEnvelope = {
      updateId: 1,
      chatId: 555,
      chatType: "private" as const,
      userId: 42,
      messageId: 10,
      text: "hello",
      isReplyToBot: false,
    };

    assert(sessionKeyForEnvelope(dmEnvelope) === "dm:555", "dm key format");
    const first = resolveSessionFile(dmEnvelope, mapPath, sessionDir);
    const second = resolveSessionFile(dmEnvelope, mapPath, sessionDir);

    assert(first.created === true, "first mapping creates session file");
    assert(second.created === false, "second mapping reuses session file");
    assert(first.sessionFile === second.sessionFile, "same DM maps to same session file");

    const map = loadSessionMap(mapPath);
    assert(map["dm:555"] === first.sessionFile, "session map persisted for DM");

    const groupEnvelope = { ...dmEnvelope, chatId: -1001, chatType: "group" as const };
    assert(sessionKeyForEnvelope(groupEnvelope) === "group:-1001", "group key format");
    const groupMapping = resolveSessionFile(groupEnvelope, mapPath, sessionDir);
    assert(groupMapping.sessionKey === "group:-1001", "group mapping key stored");
    assert(groupMapping.sessionFile !== first.sessionFile, "group uses different session file");
  }

  console.log("\n-- RPC prompt runner integration (mocked stream) --");
  {
    const fakeSpawn = (() => {
      return (_cmd: string, _args: string[]) => {
        const child = new EventEmitter() as any;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const stdin: any = {
          destroyed: false,
          writable: true,
          write: (line: string) => {
            const payload = JSON.parse(String(line).trim());
            if (payload.type === "prompt") {
              setTimeout(() => {
                stdout.write(
                  JSON.stringify({
                    type: "message_end",
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text: "ok from rpc" }],
                    },
                  }) + "\n"
                );
                stdout.write(JSON.stringify({ type: "agent_end" }) + "\n");
              }, 5);
            }
            return true;
          },
        };

        child.stdin = stdin;
        child.stdout = stdout;
        child.stderr = stderr;
        child.kill = () => {
          child.emit("exit", 0, null);
          return true;
        };
        return child;
      };
    })();

    const runner = new TelegramRpcRunner(fakeSpawn as any);
    const response = await runner.runPrompt("/tmp/fake-session.jsonl", "hello", 2000);
    assert(response === "ok from rpc", "RPC runner returns assistant text from message_end");
    runner.dispose();
  }

  console.log("\n-- outbound rendering + chunking --");
  {
    assert(renderOutboundText("   hi  ") === "hi", "render trims surrounding whitespace");
    assert(renderOutboundText("   ") === "(empty response)", "render fallback for empty output");

    const short = chunkTelegramText("hello", 10);
    assert(short.length === 1 && short[0] === "hello", "short messages stay single chunk");

    const longText = "a".repeat(9500);
    const chunks = chunkTelegramText(longText, 4096);
    assert(chunks.length === 3, "long message split into expected chunk count");
    assert(chunks.every((c) => c.length <= 4096), "all chunks respect max length");
    assert(chunks.join("") === longText, "chunks preserve message content when rejoined");
  }

  console.log("\n-- retry policy helpers --");
  {
    const e429 = new TelegramApiError("rate", 429, 2);
    assert(shouldRetryTelegramError(e429, 0) === true, "retry 429 on first attempt");
    assert(retryDelayMs(e429, 0) === 2000, "retry_after overrides delay");

    const e500 = new TelegramApiError("server", 500);
    assert(shouldRetryTelegramError(e500, 1) === true, "retry 5xx errors");
    assert(retryDelayMs(e500, 2) === 4000, "backoff for non-retry_after error");

    const e400 = new TelegramApiError("bad", 400);
    assert(shouldRetryTelegramError(e400, 0) === false, "do not retry 4xx non-rate-limit");
    assert(shouldRetryTelegramError(e500, 3) === false, "respect max attempt cap");
  }

  console.log("\n-- log event normalization --");
  {
    const logPath = join(tmp, "telegram", "events.jsonl");

    appendTelegramLog({ type: "legacy_type_event", foo: 1 }, logPath);
    appendTelegramLog({ event: "modern_event", bar: 2 }, logPath);

    const lines = readFileSync(logPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as any);
    assert(lines.length === 2, "two log lines written");
    assert(lines[0].event === "legacy_type_event", "legacy type key normalized to event");
    assert(lines[1].event === "modern_event", "modern event key preserved");
    assert(lines[0].source === "telegram", "log source is telegram");
    assert(lines[0].schema_version === 1, "log schema version present");
  }

  console.log("\n-- operator config persistence --");
  {
    const configPath = join(tmp, "telegram", "operator-config.json");

    assert(loadOperatorConfig(configPath) === null, "missing operator config returns null");

    saveOperatorConfig(
      {
        allowedChatIds: [777, 777, -1000, 12.4 as any] as any,
        allowedUserIds: [42, 42, -7],
      },
      configPath,
    );

    const loaded = loadOperatorConfig(configPath);
    assert(loaded !== null, "saved operator config loads");
    assert(JSON.stringify(loaded?.allowedChatIds) === JSON.stringify([777, -1000]), "chat ids are normalized + deduped");
    assert(JSON.stringify(loaded?.allowedUserIds) === JSON.stringify([42, -7]), "user ids are normalized + deduped");

    writeFileSync(configPath, "{not-json");
    assert(loadOperatorConfig(configPath) === null, "invalid operator config returns null");
  }

  console.log("\n-- poll leadership election + takeover --");
  {
    const lockPath = join(tmp, "telegram", "poll.lock.json");
    const staleMs = 2_000;
    const now = Date.now();

    const contenderA = createTelegramPollLeadershipState();
    const contenderB = createTelegramPollLeadershipState();

    const aInitial = stepTelegramPollLeadership(contenderA, {
      lockPath,
      nonce: "nonce-a",
      now,
      staleMs,
    });
    const bInitial = stepTelegramPollLeadership(contenderB, {
      lockPath,
      nonce: "nonce-b",
      now,
      staleMs,
    });

    assert(aInitial.isLeader !== bInitial.isLeader, "exactly one contender becomes leader");

    const leader = aInitial.isLeader ? contenderA : contenderB;
    const follower = aInitial.isLeader ? contenderB : contenderA;
    const leaderNonce = aInitial.isLeader ? "nonce-a" : "nonce-b";
    const followerNonce = aInitial.isLeader ? "nonce-b" : "nonce-a";

    for (let i = 1; i <= 3; i++) {
      stepTelegramPollLeadership(leader, {
        lockPath,
        nonce: leaderNonce,
        now: now + i * 100,
        staleMs,
      });
      const followerTick = stepTelegramPollLeadership(follower, {
        lockPath,
        nonce: followerNonce,
        now: now + i * 100,
        staleMs,
      });
      assert(followerTick.isLeader === false, "follower remains follower while leader refreshes lease");
    }

    releaseTelegramPollLeadership(leader);
    const handover = stepTelegramPollLeadership(follower, {
      lockPath,
      nonce: followerNonce,
      now: now + 500,
      staleMs,
    });
    assert(handover.isLeader === true && handover.becameLeader === true, "follower takes over after leader release");

    releaseTelegramPollLeadership(follower);

    writeFileSync(
      lockPath,
      JSON.stringify(
        {
          version: 1,
          purpose: "rho-telegram-poll-leadership",
          pid: 999_999,
          nonce: "stale-owner",
          acquiredAt: now - 10_000,
          refreshedAt: now - 10_000,
          hostname: "test-host",
        },
        null,
        2,
      ),
    );

    const staleTakeoverState = createTelegramPollLeadershipState();
    const staleTakeover = stepTelegramPollLeadership(staleTakeoverState, {
      lockPath,
      nonce: "nonce-stale-takeover",
      now: now + staleMs + 10,
      staleMs,
    });
    assert(staleTakeover.isLeader === true, "stale lock is taken over by live contender");

    releaseTelegramPollLeadership(staleTakeoverState);
  }

  console.log("\n-- mocked end-to-end pipeline --");
  {
    const update = {
      update_id: 501,
      message: {
        message_id: 77,
        from: { id: 42 },
        chat: { id: 777, type: "private" as const },
        date: 1,
        text: "hello from telegram",
      },
    };

    const normalized = normalizeInboundUpdate(update);
    assert(normalized !== null, "pipeline: normalized update");

    const settings: TelegramSettings = {
      enabled: true,
      mode: "polling",
      botTokenEnv: "TELEGRAM_BOT_TOKEN",
      pollTimeoutSeconds: 30,
      allowedChatIds: [777],
      allowedUserIds: [42],
      requireMentionInGroups: true,
    };

    const auth = authorizeInbound(normalized!, settings);
    assert(auth.ok === true, "pipeline: auth passes");

    const mapPath = join(tmp, "telegram", "session-map-e2e.json");
    const sessionDir = join(tmp, "sessions-e2e");
    const mapped = resolveSessionFile(normalized!, mapPath, sessionDir);
    assert(mapped.sessionFile.length > 0, "pipeline: session mapped");

    const fakeSpawn = ((_cmd: string, _args: string[]) => {
      const child = new EventEmitter() as any;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin: any = {
        destroyed: false,
        writable: true,
        write: (line: string) => {
          const payload = JSON.parse(String(line).trim());
          if (payload.type === "prompt") {
            setTimeout(() => {
              stdout.write(
                JSON.stringify({
                  type: "message_end",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "telegram e2e ok" }],
                  },
                }) + "\n"
              );
              stdout.write(JSON.stringify({ type: "agent_end" }) + "\n");
            }, 5);
          }
          return true;
        },
      };
      child.stdin = stdin;
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = () => {
        child.emit("exit", 0, null);
        return true;
      };
      return child;
    }) as any;

    const runner = new TelegramRpcRunner(fakeSpawn);
    const response = await runner.runPrompt(mapped.sessionFile, normalized!.text, 2000);
    const chunks = chunkTelegramText(response, 4096);

    assert(response === "telegram e2e ok", "pipeline: rpc response captured");
    assert(chunks.length === 1 && chunks[0] === "telegram e2e ok", "pipeline: outbound chunk ready");

    runner.dispose();
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== Results: ${PASS} passed, ${FAIL} failed ===`);
process.exit(FAIL > 0 ? 1 : 0);
