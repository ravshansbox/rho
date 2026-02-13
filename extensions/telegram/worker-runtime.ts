import { TelegramApiError, isTelegramParseModeError, type GetUpdatesParams, type SendChatActionParams, type SendMessageParams, type TelegramUpdate } from "./api.ts";
import {
  advanceUpdateOffset,
  loadRuntimeState,
  markPollFailure,
  markPollSuccess,
  saveRuntimeState,
  TELEGRAM_CHECK_TRIGGER_PATH,
  type TelegramRuntimeState,
  type TelegramSettings,
} from "./lib.ts";
import { authorizeInbound, normalizeInboundUpdate, type TelegramInboundEnvelope } from "./router.ts";
import { resolveSessionFile } from "./session-map.ts";
import { appendTelegramLog } from "./log.ts";
import { renderTelegramOutboundChunks } from "./outbound.ts";
import { retryDelayMs, shouldRetryTelegramError } from "./retry.ts";
import { loadOperatorConfig } from "./operator-config.ts";
import { consumeTelegramCheckTrigger, type TelegramCheckTriggerRequestV1 } from "./check-trigger.ts";
import { TelegramRpcRunner } from "./rpc.ts";
import { upsertPendingApproval } from "./pending-approvals.ts";

export interface TelegramClientLike {
  getUpdates(params: GetUpdatesParams): Promise<TelegramUpdate[]>;
  sendMessage(params: SendMessageParams): Promise<unknown>;
  sendChatAction(params: SendChatActionParams): Promise<unknown>;
}

export interface TelegramRpcRunnerLike {
  runPrompt(sessionFile: string, message: string): Promise<string>;
  dispose(): void;
}

export interface TelegramWorkerRuntimeOptions {
  settings: TelegramSettings;
  client: TelegramClientLike | null;
  botUsername?: string;
  statePath?: string;
  mapPath?: string;
  sessionDir?: string;
  checkTriggerPath?: string;
  operatorConfigPath?: string;
  rpcRunner?: TelegramRpcRunnerLike;
  logPath?: string;
  logEvent?: (event: string, context?: TelegramLogContext, extra?: Record<string, unknown>) => void;
}

export interface TelegramWorkerPollResult {
  ok: boolean;
  updates: number;
  accepted: number;
  blocked: number;
  error?: string;
  skipped?: string;
}

export interface TelegramWorkerSnapshot {
  runtimeState: TelegramRuntimeState;
  pendingInbound: number;
  pendingOutbound: number;
  sendFailures: number;
  lastCheckConsumeAt: number | null;
  lastCheckOutcome: "ok" | "error" | null;
  lastCheckRequesterPid: number | null;
}

export interface TelegramWorkerRuntime {
  pollOnce(silent?: boolean): Promise<TelegramWorkerPollResult>;
  handleCheckTrigger(): Promise<{ triggered: boolean; result?: TelegramWorkerPollResult; request: TelegramCheckTriggerRequestV1 | null }>;
  getSnapshot(): TelegramWorkerSnapshot;
  dispose(): void;
}

type TelegramLogContext = {
  updateId?: number;
  chatId?: number;
  userId?: number | null;
  messageId?: number;
  sessionKey?: string;
  sessionFile?: string;
};

export function createTelegramWorkerRuntime(options: TelegramWorkerRuntimeOptions): TelegramWorkerRuntime {
  const settings = options.settings;
  const client = options.client;
  const rpcRunner = options.rpcRunner ?? new TelegramRpcRunner();
  const botUsername = (options.botUsername || "").replace(/^@/, "").trim();
  const statePath = options.statePath;
  const mapPath = options.mapPath;
  const sessionDir = options.sessionDir;
  const checkTriggerPath = options.checkTriggerPath ?? TELEGRAM_CHECK_TRIGGER_PATH;
  const logPath = options.logPath;
  const strictAllowlist = true;

  let runtimeState: TelegramRuntimeState = loadRuntimeState(statePath);
  let pendingInbound: Array<TelegramInboundEnvelope & { sessionKey: string; sessionFile: string }> = [];
  let pendingOutbound: Array<{
    chatId: number;
    replyToMessageId?: number;
    text: string;
    attempts: number;
    notBeforeMs: number;
  }> = [];
  let drainingInbound = false;
  let pollInFlight = false;
  let consecutiveSendFailures = 0;
  let checkTriggerSeenMtimeMs = 0;
  let lastCheckConsumeAt: number | null = runtimeState.last_check_consume_at;
  let lastCheckOutcome: "ok" | "error" | null = runtimeState.last_check_outcome;
  let lastCheckRequesterPid: number | null = runtimeState.last_check_requester_pid;

  const logEvent = (event: string, context: TelegramLogContext = {}, extra: Record<string, unknown> = {}) => {
    if (options.logEvent) {
      options.logEvent(event, context, extra);
      return;
    }
    appendTelegramLog(
      {
        event,
        update_id: context.updateId,
        chat_id: context.chatId,
        user_id: context.userId,
        message_id: context.messageId,
        session_key: context.sessionKey,
        session_file: context.sessionFile,
        ...extra,
      },
      logPath,
    );
  };

  const effectiveAuthSettings = () => {
    const operatorConfig = loadOperatorConfig(options.operatorConfigPath);
    return {
      ...settings,
      allowedChatIds: operatorConfig?.allowedChatIds ?? settings.allowedChatIds,
      allowedUserIds: operatorConfig?.allowedUserIds ?? settings.allowedUserIds,
    };
  };

  const persist = () => {
    saveRuntimeState(runtimeState, statePath);
  };

  const withTypingIndicator = async <T>(chatId: number, work: () => Promise<T>): Promise<T> => {
    if (!client) return await work();

    let timer: NodeJS.Timeout | null = null;
    const sendTyping = async () => {
      try {
        await client.sendChatAction({ chat_id: chatId, action: "typing" });
      } catch {
        // Ignore typing indicator failures; they are non-critical.
      }
    };

    void sendTyping();
    timer = setInterval(() => { void sendTyping(); }, 4000);

    try {
      return await work();
    } finally {
      if (timer) clearInterval(timer);
    }
  };

  const drainInboundQueue = async () => {
    if (drainingInbound) return;
    drainingInbound = true;
    try {
      while (pendingInbound.length > 0) {
        const item = pendingInbound.shift()!;
        try {
          const response = await withTypingIndicator(item.chatId, () => rpcRunner.runPrompt(item.sessionFile, item.text));
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
    }
  };

  const flushOutboundQueue = async () => {
    if (!client) return;
    const deferred: typeof pendingOutbound = [];

    while (pendingOutbound.length > 0) {
      const item = pendingOutbound.shift()!;
      if (item.notBeforeMs > Date.now()) {
        deferred.push(item);
        continue;
      }

      const chunks = renderTelegramOutboundChunks(item.text);
      let failed = false;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let sentTextPreview = chunk.text;

        try {
          try {
            await client.sendMessage({
              chat_id: item.chatId,
              text: chunk.text,
              parse_mode: chunk.parseMode,
              disable_web_page_preview: true,
              reply_to_message_id: i === 0 ? item.replyToMessageId : undefined,
            });
          } catch (error) {
            if (chunk.parseMode && isTelegramParseModeError(error)) {
              await client.sendMessage({
                chat_id: item.chatId,
                text: chunk.fallbackText,
                disable_web_page_preview: true,
                reply_to_message_id: i === 0 ? item.replyToMessageId : undefined,
              });
              sentTextPreview = chunk.fallbackText;
              logEvent(
                "outbound_parse_mode_fallback",
                {
                  chatId: item.chatId,
                  messageId: i === 0 ? item.replyToMessageId : undefined,
                },
                {
                  chunk_index: i,
                  chunk_count: chunks.length,
                  attempts: item.attempts,
                  parse_mode: chunk.parseMode,
                },
              );
            } else {
              throw error;
            }
          }

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
              text_preview: sentTextPreview.slice(0, 120),
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
  };

  const pollOnce = async (silent = true): Promise<TelegramWorkerPollResult> => {
    if (!settings.enabled || !client || settings.mode !== "polling") {
      return { ok: false, updates: 0, accepted: 0, blocked: 0, skipped: "disabled_or_invalid_mode" };
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

        const auth = authorizeInbound(envelope, effectiveAuthSettings(), botUsername || undefined, strictAllowlist);
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

          if (strictAllowlist && (auth.reason === "chat_not_allowed" || auth.reason === "user_not_allowed")) {
            const pending = upsertPendingApproval({
              chatId: envelope.chatId,
              userId: envelope.userId,
              textPreview: envelope.text.slice(0, 160),
            });

            logEvent(
              "inbound_pending_approval",
              {
                updateId: envelope.updateId,
                chatId: envelope.chatId,
                userId: envelope.userId,
                messageId: envelope.messageId,
              },
              {
                pin: pending.request.pin,
                pending_created: pending.created,
              },
            );

            if (pending.created) {
              try {
                await client.sendMessage({
                  chat_id: envelope.chatId,
                  text: `🔒 Access request received. Share this PIN with the operator to approve: ${pending.request.pin}`,
                  reply_to_message_id: envelope.messageId,
                });
              } catch {
                // ignore notification failures for blocked users
              }
            }
          }

          continue;
        }

        const mapped = resolveSessionFile(envelope, mapPath, sessionDir);
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

      await drainInboundQueue();
      await flushOutboundQueue();

      logEvent("poll_ok", {}, {
        updates: updates.length,
        accepted,
        blocked,
        last_update_id: runtimeState.last_update_id,
        poll_failures: runtimeState.consecutive_failures,
        send_failures: consecutiveSendFailures,
      });

      if (!silent) {
        // no-op (worker has no UI)
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
      return { ok: false, updates: 0, accepted: 0, blocked: 0, error: msg };
    } finally {
      pollInFlight = false;
    }
  };

  const executeOperatorCheck = async (
    source: "trigger" | "manual",
    options?: { requesterPid?: number | null; silent?: boolean },
  ) => {
    const result = await pollOnce(options?.silent ?? source === "trigger");
    logEvent("operator_check_executed", {}, {
      check_source: source,
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

  const handleCheckTrigger = async () => {
    const consumed = consumeTelegramCheckTrigger(checkTriggerPath, checkTriggerSeenMtimeMs);
    checkTriggerSeenMtimeMs = consumed.nextSeen;
    if (!consumed.triggered) {
      return { triggered: false, result: undefined, request: consumed.request };
    }

    logEvent("operator_check_trigger_consumed", {}, {
      consumed_by_pid: process.pid,
      requester_pid: consumed.request?.requesterPid ?? null,
      requester_role: consumed.request?.requesterRole ?? null,
      requested_at: consumed.request?.requestedAt ?? null,
      check_source: consumed.request?.source ?? null,
    });

    lastCheckConsumeAt = Date.now();
    lastCheckRequesterPid = consumed.request?.requesterPid ?? null;
    runtimeState.last_check_request_at = consumed.request?.requestedAt ?? null;
    runtimeState.last_check_consume_at = lastCheckConsumeAt;
    runtimeState.last_check_requester_pid = lastCheckRequesterPid;

    try {
      const result = await executeOperatorCheck("trigger", {
        requesterPid: consumed.request?.requesterPid ?? null,
        silent: true,
      });
      lastCheckOutcome = result.ok ? "ok" : "error";
      runtimeState.last_check_outcome = lastCheckOutcome;
      persist();
      return { triggered: true, result, request: consumed.request };
    } catch (error) {
      lastCheckOutcome = "error";
      runtimeState.last_check_outcome = lastCheckOutcome;
      persist();
      throw error;
    }
  };

  const getSnapshot = (): TelegramWorkerSnapshot => ({
    runtimeState,
    pendingInbound: pendingInbound.length,
    pendingOutbound: pendingOutbound.length,
    sendFailures: consecutiveSendFailures,
    lastCheckConsumeAt,
    lastCheckOutcome,
    lastCheckRequesterPid,
  });

  const dispose = () => {
    rpcRunner.dispose();
  };

  return {
    pollOnce,
    handleCheckTrigger,
    getSnapshot,
    dispose,
  };
}
