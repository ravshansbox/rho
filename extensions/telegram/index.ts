/**
 * Rho Telegram Extension (polling MVP foundation)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { TelegramApiError, TelegramClient } from "./api.ts";
import {
  advanceUpdateOffset,
  loadRuntimeState,
  markPollFailure,
  markPollSuccess,
  readTelegramSettings,
  saveRuntimeState,
  TELEGRAM_CHECK_TRIGGER_PATH,
  TELEGRAM_POLL_LOCK_PATH,
  type TelegramRuntimeState,
} from "./lib.ts";
import { authorizeInbound, normalizeInboundUpdate, type TelegramInboundEnvelope } from "./router.ts";
import { appendTelegramLog } from "./log.ts";
import { loadSessionMap, resolveSessionFile } from "./session-map.ts";
import { TelegramRpcRunner } from "./rpc.ts";
import { chunkTelegramText } from "./outbound.ts";
import { retryDelayMs, shouldRetryTelegramError } from "./retry.ts";
import { loadOperatorConfig, saveOperatorConfig } from "./operator-config.ts";
import {
  createTelegramPollLeadershipState,
  readTelegramPollLockOwner,
  releaseTelegramPollLeadership,
  stepTelegramPollLeadership,
} from "./poll-leadership.ts";
import {
  consumeTelegramCheckTrigger,
  getTelegramCheckTriggerState,
  requestTelegramCheckTrigger,
} from "./check-trigger.ts";
import { renderTelegramStatusText, renderTelegramUiStatus } from "./status.ts";

const DEFAULT_POLL_LOCK_REFRESH_MS = 15_000;
const DEFAULT_POLL_LOCK_STALE_MS = 90_000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function setStatus(ctx: ExtensionContext, text: string, level: "dim" | "warning" | "error" = "dim"): void {
  if (!ctx.hasUI) return;
  const theme = ctx.ui.theme;
  const color = level === "error" ? "error" : level === "warning" ? "warning" : "dim";
  ctx.ui.setStatus("telegram", theme.fg(color, text));
}

export default function (pi: ExtensionAPI) {
  if (process.env.RHO_SUBAGENT === "1") return;

  const settings = readTelegramSettings();
  const token = process.env[settings.botTokenEnv] || "";
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();
  const operatorConfig = loadOperatorConfig();

  const pollLockRefreshMs = parsePositiveIntEnv("RHO_TELEGRAM_POLL_LOCK_REFRESH_MS", DEFAULT_POLL_LOCK_REFRESH_MS);
  const pollLockStaleMs = parsePositiveIntEnv("RHO_TELEGRAM_POLL_LOCK_STALE_MS", DEFAULT_POLL_LOCK_STALE_MS);

  let runtimeAllowedChatIds = [...(operatorConfig?.allowedChatIds ?? settings.allowedChatIds)];
  let runtimeAllowedUserIds = [...(operatorConfig?.allowedUserIds ?? settings.allowedUserIds)];

  let pollTimer: NodeJS.Timeout | null = null;
  let pollLeadershipTimer: NodeJS.Timeout | null = null;
  let pollExitHandlersInstalled = false;
  const pollLeadershipState = createTelegramPollLeadershipState();
  const pollLockNonce = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  let pollInFlight = false;
  let checkTriggerSeenMtimeMs = 0;
  let lastCheckRequestAtMs: number | null = null;
  let lastCheckRequesterPid: number | null = null;
  let lastCheckConsumeAtMs: number | null = null;
  let lastCheckOutcome: "ok" | "error" | null = null;

  let runtimeState: TelegramRuntimeState = loadRuntimeState();
  let latestCtx: ExtensionContext | null = null;
  let pendingInbound: Array<TelegramInboundEnvelope & { sessionKey: string; sessionFile: string }> = [];
  let pendingOutbound: Array<{
    chatId: number;
    replyToMessageId?: number;
    text: string;
    attempts: number;
    notBeforeMs: number;
  }> = [];
  let drainingInbound = false;
  let consecutiveSendFailures = 0;

  const client = token.trim() ? new TelegramClient(token.trim()) : null;
  const rpcRunner = new TelegramRpcRunner();

  const effectiveAuthSettings = () => ({
    ...settings,
    allowedChatIds: runtimeAllowedChatIds,
    allowedUserIds: runtimeAllowedUserIds,
  });

  const persistOperator = () => {
    saveOperatorConfig({
      allowedChatIds: runtimeAllowedChatIds,
      allowedUserIds: runtimeAllowedUserIds,
    });
  };

  type TelegramLogContext = {
    updateId?: number;
    chatId?: number;
    userId?: number | null;
    messageId?: number;
    sessionKey?: string;
    sessionFile?: string;
  };

  const logEvent = (event: string, context: TelegramLogContext = {}, extra: Record<string, unknown> = {}) => {
    appendTelegramLog({
      event,
      update_id: context.updateId,
      chat_id: context.chatId,
      user_id: context.userId,
      message_id: context.messageId,
      session_key: context.sessionKey,
      session_file: context.sessionFile,
      ...extra,
    });
  };

  const leadershipText = () => {
    const owner = readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH);
    if (pollLeadershipState.isLeader) {
      return `leader (pid ${process.pid})`;
    }
    if (owner?.pid) {
      const host = owner.hostname ? ` @${owner.hostname}` : "";
      return `follower (leader pid ${owner.pid}${host})`;
    }
    if (pollLeadershipState.ownerPid) {
      return `follower (leader pid ${pollLeadershipState.ownerPid})`;
    }
    return "follower (no active leader)";
  };

  const requestLeaderCheck = (source: "tool" | "command"): boolean => {
    const requestedAt = Date.now();
    const requested = requestTelegramCheckTrigger(TELEGRAM_CHECK_TRIGGER_PATH, {
      requestedAt,
      requesterPid: process.pid,
      requesterRole: pollLeadershipState.isLeader ? "leader" : "follower",
      source,
    });

    if (requested) {
      lastCheckRequestAtMs = requestedAt;
      lastCheckRequesterPid = process.pid;
      logEvent("operator_check_requested", {}, {
        route: pollLeadershipState.isLeader ? "leader_local" : "follower_trigger",
        requested_at: requestedAt,
        requester_pid: process.pid,
        source,
        owner_pid: readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH)?.pid ?? null,
      });
    }

    return requested;
  };

  const applyAllowlistMutation = (target: "chat" | "user", action: "allow" | "revoke", id: number) => {
    const current = target === "chat" ? runtimeAllowedChatIds : runtimeAllowedUserIds;
    const next = new Set(current);
    if (action === "allow") next.add(id);
    else next.delete(id);

    if (target === "chat") runtimeAllowedChatIds = [...next];
    else runtimeAllowedUserIds = [...next];

    persistOperator();
    logEvent("operator_allowlist_changed", {}, {
      target,
      action,
      id,
      allowed_chats: runtimeAllowedChatIds,
      allowed_users: runtimeAllowedUserIds,
    });
  };

  const refreshStatus = (ctx: ExtensionContext) => {
    if (!settings.enabled) {
      setStatus(ctx, "tg off", "dim");
      return;
    }
    if (!client) {
      setStatus(ctx, "tg no-token", "warning");
      return;
    }
    if (runtimeState.consecutive_failures >= 3) {
      setStatus(ctx, `tg poll-err(${runtimeState.consecutive_failures})`, "error");
      return;
    }
    if (consecutiveSendFailures >= 3) {
      setStatus(ctx, `tg send-err(${consecutiveSendFailures})`, "error");
      return;
    }
    const ownerPid = pollLeadershipState.isLeader
      ? process.pid
      : readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH)?.pid ?? pollLeadershipState.ownerPid;
    const triggerState = getTelegramCheckTriggerState(TELEGRAM_CHECK_TRIGGER_PATH, checkTriggerSeenMtimeMs);
    setStatus(
      ctx,
      renderTelegramUiStatus({
        mode: settings.mode,
        isLeader: pollLeadershipState.isLeader,
        ownerPid,
        lastUpdateId: runtimeState.last_update_id,
        pendingInbound: pendingInbound.length,
        pendingOutbound: pendingOutbound.length,
        pollFailures: runtimeState.consecutive_failures,
        sendFailures: consecutiveSendFailures,
        triggerPending: triggerState.pending,
      }),
      "dim",
    );
  };

  const persist = () => {
    saveRuntimeState(runtimeState);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const stopPollLeadership = () => {
    if (pollLeadershipTimer) {
      clearInterval(pollLeadershipTimer);
      pollLeadershipTimer = null;
    }
    releaseTelegramPollLeadership(pollLeadershipState);
    pollLeadershipState.ownerPid = readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH)?.pid ?? null;
    stopPolling();
  };

  const installPollExitHandlers = () => {
    if (pollExitHandlersInstalled) return;
    pollExitHandlersInstalled = true;

    const cleanup = () => {
      stopPollLeadership();
      rpcRunner.dispose();
    };

    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  };

  const drainInboundQueue = async (ctx: ExtensionContext) => {
    if (drainingInbound) return;
    drainingInbound = true;
    try {
      while (pendingInbound.length > 0) {
        const item = pendingInbound.shift()!;
        try {
          const response = await rpcRunner.runPrompt(item.sessionFile, item.text);
          pendingOutbound.push({
            chatId: item.chatId,
            replyToMessageId: item.messageId,
            text: response || "(No response)",
            attempts: 0,
            notBeforeMs: 0,
          });
          logEvent(
            "rpc_prompt_ok",
            {
              updateId: item.updateId,
              chatId: item.chatId,
              userId: item.userId,
              messageId: item.messageId,
              sessionKey: item.sessionKey,
              sessionFile: item.sessionFile,
            },
            { response_length: response.length },
          );
        } catch (error) {
          const msg = (error as Error)?.message || String(error);
          pendingOutbound.push({
            chatId: item.chatId,
            replyToMessageId: item.messageId,
            text: `⚠️ Failed to run prompt: ${msg}`,
            attempts: 0,
            notBeforeMs: 0,
          });
          logEvent(
            "rpc_prompt_error",
            {
              updateId: item.updateId,
              chatId: item.chatId,
              userId: item.userId,
              messageId: item.messageId,
              sessionKey: item.sessionKey,
              sessionFile: item.sessionFile,
            },
            { error: msg },
          );
        }
      }
    } finally {
      drainingInbound = false;
      refreshStatus(ctx);
    }
  };

  const flushOutboundQueue = async (ctx: ExtensionContext) => {
    if (!client) return;
    const deferred: typeof pendingOutbound = [];

    while (pendingOutbound.length > 0) {
      const item = pendingOutbound.shift()!;
      if (item.notBeforeMs > Date.now()) {
        deferred.push(item);
        continue;
      }

      const chunks = chunkTelegramText(item.text);
      let failed = false;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
          await client.sendMessage({
            chat_id: item.chatId,
            text: chunk,
            reply_to_message_id: i === 0 ? item.replyToMessageId : undefined,
          });
          consecutiveSendFailures = 0;
          logEvent(
            "outbound_sent",
            {
              chatId: item.chatId,
              messageId: i === 0 ? item.replyToMessageId : undefined,
            },
            {
              chunk_index: i,
              chunk_count: chunks.length,
              attempts: item.attempts,
              text_preview: chunk.slice(0, 120),
            },
          );
        } catch (error) {
          failed = true;
          consecutiveSendFailures += 1;
          const msg = (error as Error)?.message || String(error);
          logEvent(
            "outbound_error",
            { chatId: item.chatId },
            {
              chunk_index: i,
              chunk_count: chunks.length,
              attempts: item.attempts,
              error: msg,
            },
          );

          if (shouldRetryTelegramError(error, item.attempts)) {
            const delay = retryDelayMs(error, item.attempts);
            deferred.push({
              ...item,
              attempts: item.attempts + 1,
              notBeforeMs: Date.now() + delay,
            });
            logEvent(
              "outbound_retry_scheduled",
              { chatId: item.chatId },
              {
                attempts: item.attempts + 1,
                retry_in_ms: delay,
              },
            );
          } else if (ctx.hasUI) {
            ctx.ui.notify(`Telegram send failed: ${msg}`, "warning");
          }
          break;
        }
      }

      if (!failed) {
        // no-op
      }
    }

    if (deferred.length > 0) {
      pendingOutbound = [...pendingOutbound, ...deferred];
    }

    refreshStatus(ctx);
  };

  const pollOnce = async (
    ctx: ExtensionContext,
    silent = true,
  ): Promise<{ ok: boolean; updates: number; accepted: number; blocked: number; error?: string; skipped?: string }> => {
    if (!settings.enabled || !client || settings.mode !== "polling") {
      return { ok: false, updates: 0, accepted: 0, blocked: 0, skipped: "disabled_or_invalid_mode" };
    }
    if (!pollLeadershipState.isLeader) {
      return { ok: false, updates: 0, accepted: 0, blocked: 0, skipped: "not_leader" };
    }
    if (pollInFlight) {
      return { ok: false, updates: 0, accepted: 0, blocked: 0, skipped: "poll_in_flight" };
    }

    pollInFlight = true;
    try {
      const updates = await client.getUpdates({
        offset: runtimeState.last_update_id,
        timeout: settings.pollTimeoutSeconds,
        allowed_updates: ["message", "edited_message"],
      });

      let accepted = 0;
      let blocked = 0;
      for (const update of updates) {
        const envelope = normalizeInboundUpdate(update);
        if (!envelope) continue;

        const auth = authorizeInbound(envelope, effectiveAuthSettings(), botUsername || undefined);
        if (!auth.ok) {
          blocked += 1;
          logEvent(
            "inbound_blocked",
            {
              updateId: envelope.updateId,
              chatId: envelope.chatId,
              userId: envelope.userId,
              messageId: envelope.messageId,
            },
            { reason: auth.reason },
          );
          continue;
        }

        const mapped = resolveSessionFile(envelope);
        accepted += 1;
        pendingInbound.push({ ...envelope, sessionKey: mapped.sessionKey, sessionFile: mapped.sessionFile });
        logEvent(
          "inbound_accepted",
          {
            updateId: envelope.updateId,
            chatId: envelope.chatId,
            userId: envelope.userId,
            messageId: envelope.messageId,
            sessionKey: mapped.sessionKey,
            sessionFile: mapped.sessionFile,
          },
          {
            mapping_created: mapped.created,
            text_preview: envelope.text.slice(0, 160),
          },
        );
      }

      const updateIds = updates.map((u) => u.update_id);
      runtimeState.last_update_id = advanceUpdateOffset(runtimeState.last_update_id, updateIds);
      runtimeState = markPollSuccess(runtimeState);
      persist();

      await drainInboundQueue(ctx);
      await flushOutboundQueue(ctx);

      logEvent("poll_ok", {}, {
        updates: updates.length,
        accepted,
        blocked,
        last_update_id: runtimeState.last_update_id,
        poll_failures: runtimeState.consecutive_failures,
        send_failures: consecutiveSendFailures,
      });

      if (!silent && ctx.hasUI) {
        ctx.ui.notify(
          `Telegram poll ok (${updates.length} updates, ${accepted} accepted, ${blocked} blocked)`,
          "info",
        );
      }

      return { ok: true, updates: updates.length, accepted, blocked };
    } catch (error) {
      runtimeState = markPollFailure(runtimeState);
      persist();
      const msg = error instanceof TelegramApiError ? error.message : (error as Error)?.message || String(error);
      logEvent("poll_error", {}, {
        error: msg,
        last_update_id: runtimeState.last_update_id,
        poll_failures: runtimeState.consecutive_failures,
      });
      if (!silent && ctx.hasUI) {
        ctx.ui.notify(`Telegram poll failed: ${msg}`, "warning");
      }
      return { ok: false, updates: 0, accepted: 0, blocked: 0, error: msg };
    } finally {
      pollInFlight = false;
      refreshStatus(ctx);
    }
  };

  const startPolling = async (ctx: ExtensionContext) => {
    stopPolling();
    refreshStatus(ctx);
    if (!settings.enabled || !client || settings.mode !== "polling") return;
    if (!pollLeadershipState.isLeader) return;

    await pollOnce(ctx, true);
    const intervalMs = Math.max(settings.pollTimeoutSeconds * 1000, 10_000);
    pollTimer = setInterval(() => {
      if (!latestCtx) return;
      if (!pollLeadershipState.isLeader) return;
      void pollOnce(latestCtx, true);
    }, intervalMs);
  };

  const executeOperatorCheck = async (
    ctx: ExtensionContext,
    source: "tool" | "command" | "trigger",
    options?: { requesterPid?: number | null; silent?: boolean },
  ) => {
    const result = await pollOnce(ctx, options?.silent ?? source === "trigger");
    if (!result.skipped) {
      lastCheckOutcome = result.ok ? "ok" : "error";
    }
    logEvent("operator_check_executed", {}, {
      source,
      requester_pid: options?.requesterPid ?? null,
      executed_by_pid: process.pid,
      result: result.ok ? "ok" : "error",
      skipped: result.skipped ?? null,
      updates: result.updates,
      accepted: result.accepted,
      blocked: result.blocked,
      error: result.error,
    });
    return result;
  };

  const runLeadershipStep = async (ctx: ExtensionContext) => {
    const now = Date.now();
    const step = stepTelegramPollLeadership(pollLeadershipState, {
      lockPath: TELEGRAM_POLL_LOCK_PATH,
      nonce: pollLockNonce,
      now,
      staleMs: pollLockStaleMs,
    });

    if (step.becameLeader) {
      logEvent("poll_leadership_acquired", {}, {
        lock_path: TELEGRAM_POLL_LOCK_PATH,
        owner_pid: process.pid,
      });
      await startPolling(ctx);
    } else if (step.lostLeadership) {
      stopPolling();
      logEvent("poll_leadership_lost", {}, {
        lock_path: TELEGRAM_POLL_LOCK_PATH,
        owner_pid: step.ownerPid,
      });
    } else if (!step.isLeader) {
      stopPolling();
    }

    if (pollLeadershipState.isLeader) {
      const consumed = consumeTelegramCheckTrigger(TELEGRAM_CHECK_TRIGGER_PATH, checkTriggerSeenMtimeMs);
      checkTriggerSeenMtimeMs = consumed.nextSeen;
      if (consumed.triggered) {
        lastCheckConsumeAtMs = Date.now();
        lastCheckRequesterPid = consumed.request?.requesterPid ?? null;
        logEvent("operator_check_trigger_consumed", {}, {
          consumed_by_pid: process.pid,
          requester_pid: consumed.request?.requesterPid ?? null,
          requester_role: consumed.request?.requesterRole ?? null,
          requested_at: consumed.request?.requestedAt ?? null,
          source: consumed.request?.source ?? null,
        });
        await executeOperatorCheck(ctx, "trigger", {
          requesterPid: consumed.request?.requesterPid ?? null,
          silent: true,
        });
      }
    }

    refreshStatus(ctx);
  };

  const startPollLeadership = async (ctx: ExtensionContext) => {
    latestCtx = ctx;
    installPollExitHandlers();

    if (!settings.enabled || !client || settings.mode !== "polling") {
      stopPollLeadership();
      refreshStatus(ctx);
      return;
    }

    await runLeadershipStep(ctx);

    if (pollLeadershipTimer) return;
    pollLeadershipTimer = setInterval(() => {
      if (!latestCtx) return;
      void runLeadershipStep(latestCtx);
    }, pollLockRefreshMs);
  };

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    await startPollLeadership(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    latestCtx = ctx;
    await startPollLeadership(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPollLeadership();
    rpcRunner.dispose();
  });

  const statusText = () => {
    const owner = readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH);
    const triggerState = getTelegramCheckTriggerState(TELEGRAM_CHECK_TRIGGER_PATH, checkTriggerSeenMtimeMs);
    return renderTelegramStatusText({
      enabled: settings.enabled,
      mode: settings.mode,
      leadershipText: leadershipText(),
      pollLockPath: TELEGRAM_POLL_LOCK_PATH,
      pollLockOwnerText: owner ? `${owner.pid} @${owner.hostname}` : "none",
      triggerPath: TELEGRAM_CHECK_TRIGGER_PATH,
      triggerPending: triggerState.pending,
      triggerRequesterPid: triggerState.requesterPid ?? lastCheckRequesterPid,
      triggerRequestedAt: triggerState.requestedAt,
      lastCheckRequestAt: lastCheckRequestAtMs,
      lastCheckConsumeAt: lastCheckConsumeAtMs,
      lastCheckOutcome,
      tokenEnv: settings.botTokenEnv,
      lastUpdateId: runtimeState.last_update_id,
      lastPollAt: runtimeState.last_poll_at,
      pollFailures: runtimeState.consecutive_failures,
      sendFailures: consecutiveSendFailures,
      pendingInbound: pendingInbound.length,
      pendingOutbound: pendingOutbound.length,
      allowedChatsText: runtimeAllowedChatIds.length === 0 ? "all" : runtimeAllowedChatIds.join(","),
      allowedUsersText: runtimeAllowedUserIds.length === 0 ? "all" : runtimeAllowedUserIds.join(","),
    });
  };

  pi.registerTool({
    name: "telegram",
    label: "Telegram",
    description: "Operate Telegram channel bridge. Actions: status, check, send, allow, revoke, list_chats",
    parameters: Type.Object({
      action: StringEnum(["status", "check", "send", "allow", "revoke", "list_chats"] as const),
      target: Type.Optional(StringEnum(["chat", "user"] as const)),
      id: Type.Optional(Type.Integer()),
      chat_id: Type.Optional(Type.Integer()),
      text: Type.Optional(Type.String()),
      reply_to_message_id: Type.Optional(Type.Integer()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      latestCtx = ctx;

      if (params.action === "status") {
        refreshStatus(ctx);
        return { content: [{ type: "text", text: statusText() }] };
      }

      if (params.action === "list_chats") {
        const map = loadSessionMap();
        const entries = Object.entries(map);
        const text = entries.length === 0
          ? "No mapped chats yet."
          : entries.map(([k, v]) => `${k} -> ${v}`).join("\n");
        return { content: [{ type: "text", text }] };
      }

      if (!settings.enabled) {
        return { content: [{ type: "text", text: "Telegram is disabled in init.toml" }] };
      }

      if (!client) {
        return { content: [{ type: "text", text: `Missing token env: ${settings.botTokenEnv}` }] };
      }

      if (params.action === "check") {
        if (!pollLeadershipState.isLeader) {
          const requested = requestLeaderCheck("tool");
          const owner = readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH);
          const ownerText = owner?.pid ? ` (leader pid ${owner.pid})` : "";
          const text = requested
            ? `Requested Telegram check from follower${ownerText}\n${statusText()}`
            : `Failed to request Telegram check${ownerText}\n${statusText()}`;
          return { content: [{ type: "text", text }] };
        }

        await executeOperatorCheck(ctx, "tool", { silent: false });
        return { content: [{ type: "text", text: statusText() }] };
      }

      if (params.action === "send") {
        const text = typeof params.text === "string" ? params.text : "";
        if (!Number.isInteger(params.chat_id) || text.trim().length === 0) {
          return { content: [{ type: "text", text: "send requires chat_id and non-empty text" }] };
        }
        pendingOutbound.push({
          chatId: params.chat_id,
          replyToMessageId: params.reply_to_message_id,
          text,
          attempts: 0,
          notBeforeMs: 0,
        });
        await flushOutboundQueue(ctx);
        return { content: [{ type: "text", text: `queued send to ${params.chat_id}` }] };
      }

      if (params.action === "allow" || params.action === "revoke") {
        if (!params.target || !Number.isInteger(params.id)) {
          return { content: [{ type: "text", text: `${params.action} requires target=(chat|user) and integer id` }] };
        }

        applyAllowlistMutation(params.target, params.action, params.id);
        refreshStatus(ctx);
        return { content: [{ type: "text", text: statusText() }] };
      }

      return { content: [{ type: "text", text: "Unknown action" }] };
    },
  });

  pi.registerCommand("telegram", {
    description: "Telegram channel status and controls",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "status").toLowerCase();

      if (sub === "status") {
        refreshStatus(ctx);
        ctx.ui.notify(statusText(), "info");
        return;
      }

      if (sub === "check") {
        if (!pollLeadershipState.isLeader) {
          const requested = requestLeaderCheck("command");
          const owner = readTelegramPollLockOwner(TELEGRAM_POLL_LOCK_PATH);
          const ownerText = owner?.pid ? ` (leader pid ${owner.pid})` : "";
          ctx.ui.notify(
            requested
              ? `Requested Telegram check from follower${ownerText}`
              : `Failed to request Telegram check${ownerText}`,
            requested ? "info" : "warning",
          );
          return;
        }

        await executeOperatorCheck(ctx, "command", { silent: false });
        return;
      }

      if (sub === "allow-chat" || sub === "revoke-chat" || sub === "allow-user" || sub === "revoke-user") {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) {
          ctx.ui.notify("Usage: /telegram allow-chat|revoke-chat|allow-user|revoke-user <id>", "warning");
          return;
        }

        const target = sub.includes("chat") ? "chat" : "user";
        const action = sub.startsWith("allow") ? "allow" : "revoke";
        applyAllowlistMutation(target, action, id);

        refreshStatus(ctx);
        ctx.ui.notify(statusText(), "success");
        return;
      }

      ctx.ui.notify("Usage: /telegram [status|check|allow-chat|revoke-chat|allow-user|revoke-user]", "warning");
    },
  });
}
