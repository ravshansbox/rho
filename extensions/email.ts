/**
 * Rho Email Extension -- inbox polling and management for agent email
 *
 * Polls tau@runrho.dev inbox every 5 minutes. Shows unread count in
 * the status bar, fires notifications on new mail, and exposes an
 * `email` tool for the LLM to read and act on messages.
 *
 * Credentials: ~/.config/rho-cloud/credentials.json
 *   { "api_key": "...", "agent_id": "...", "email": "tau@runrho.dev" }
 *
 * Usage:
 *   /email              -- Show unread count
 *   /email list         -- List unread messages
 *   /email read <id>    -- Read a specific message
 *   /email act <id>     -- Mark message as acted
 *   /email check        -- Force an inbox check now
 *   /email send <to> <subject> -- Send a quick email
 *
 * LLM tool:
 *   email(action="check")                    -- Poll inbox, return unread
 *   email(action="list", status?)            -- List messages
 *   email(action="read", id="...")           -- Read single message
 *   email(action="act", id="...", log="...")  -- Mark acted with log
 *   email(action="archive", id="...")        -- Archive message
 *   email(action="send", to="...", subject="...", body="...") -- Send email
 *   email(action="send", to="...", body="...", in_reply_to="...") -- Reply
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ─── Config ──────────────────────────────────────────────────────────

const CREDS_PATH = join(process.env.HOME || "", ".config", "rho-cloud", "credentials.json");
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const API_BASE = "https://api.runrho.dev/v1";

interface Credentials {
  api_key: string;
  agent_id: string;
  email: string;
}

interface InboxMessage {
  id: string;
  agent_id: string;
  sender: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  raw_key: string | null;
  size_bytes: number;
  received_at: string;
  status: string;
  action_log: string | null;
}

interface InboxResponse {
  ok: boolean;
  data: InboxMessage[];
  pagination: { total: number; limit: number; offset: number };
  error?: string;
}

interface MessageResponse {
  ok: boolean;
  data: InboxMessage;
  error?: string;
}

interface SendResponse {
  ok: boolean;
  data?: { outbox_id: string; message_id: string; status: string };
  error?: string;
  tier?: string;
  limit?: number;
}

// ─── API Client ──────────────────────────────────────────────────────

function loadCredentials(): Credentials | null {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function apiFetch(
  creds: Credentials,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retries = 2,
): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${creds.api_key}` };
  if (body) headers["Content-Type"] = "application/json";

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Don't retry client errors (4xx), only server errors (5xx) and network issues
      if (res.status >= 400 && res.status < 500) {
        try { return await res.json(); } catch {
          return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
        }
      }

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // linear backoff
          continue;
        }
        try { return await res.json(); } catch {
          return { ok: false, error: lastError.message };
        }
      }

      try { return await res.json(); } catch {
        return { ok: false, error: "Invalid JSON response from API" };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  return { ok: false, error: `Network error after ${retries + 1} attempts: ${lastError?.message || "unknown"}` };
}

async function apiGet(creds: Credentials, path: string): Promise<unknown> {
  return apiFetch(creds, "GET", path);
}

async function apiPost(creds: Credentials, path: string, body: Record<string, unknown>): Promise<unknown> {
  return apiFetch(creds, "POST", path, body);
}

async function apiPatch(creds: Credentials, path: string, body: Record<string, unknown>): Promise<unknown> {
  return apiFetch(creds, "PATCH", path, body);
}

async function fetchInbox(creds: Credentials, status = "unread", limit = 20): Promise<InboxResponse> {
  return apiGet(creds, `/agents/${creds.agent_id}/inbox?status=${status}&limit=${limit}`) as Promise<InboxResponse>;
}

async function fetchMessage(creds: Credentials, msgId: string): Promise<MessageResponse> {
  return apiGet(creds, `/agents/${creds.agent_id}/inbox/${msgId}`) as Promise<MessageResponse>;
}

async function markMessage(creds: Credentials, msgId: string, status: string, actionLog?: string): Promise<MessageResponse> {
  const body: Record<string, unknown> = { status };
  if (actionLog) body.action_log = actionLog;
  return apiPatch(creds, `/agents/${creds.agent_id}/inbox/${msgId}`, body) as Promise<MessageResponse>;
}

async function sendOutbound(
  creds: Credentials,
  recipient: string,
  subject: string,
  body: string,
  inReplyTo?: string,
): Promise<SendResponse> {
  const payload: Record<string, unknown> = { recipient, subject, body };
  if (inReplyTo) payload.in_reply_to = inReplyTo;
  return apiPost(creds, `/agents/${creds.agent_id}/outbox`, payload) as Promise<SendResponse>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function notify(title: string, body: string) {
  try {
    execSync(
      `termux-notification --title ${shellEscape(title)} --content ${shellEscape(body)} --id rho-email`,
      { stdio: "ignore", timeout: 5000 }
    );
  } catch {
    // not critical
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

function formatMessage(msg: InboxMessage, full = false): string {
  const lines = [
    `From: ${msg.sender}`,
    `Subject: ${msg.subject || "(no subject)"}`,
    `Date: ${msg.received_at}`,
    `Status: ${msg.status}`,
    `ID: ${msg.id}`,
  ];
  if (full) {
    lines.push("", "--- Body ---", msg.body_text || "(empty)");
    if (msg.action_log) {
      lines.push("", "--- Action Log ---", msg.action_log);
    }
  }
  return lines.join("\n");
}

function formatMessageList(messages: InboxMessage[], total: number): string {
  if (messages.length === 0) return "No messages.";
  const lines = [`${total} message(s):\n`];
  for (const msg of messages) {
    const subj = msg.subject || "(no subject)";
    const preview = (msg.body_text || "").slice(0, 80).replace(/\n/g, " ").trim();
    lines.push(`  ${msg.id}  ${msg.sender}`);
    lines.push(`    ${subj}${preview ? " -- " + preview : ""}`);
    lines.push(`    ${msg.received_at}  [${msg.status}]`);
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  if (process.env.RHO_SUBAGENT === "1") return;

  const creds = loadCredentials();
  if (!creds) {
    // No credentials -- register a stub that tells the user
    pi.registerCommand("email", {
      description: "Agent email (not configured)",
      handler: async (_args, ctx) => {
        ctx.ui.notify("No rho-cloud credentials at ~/.config/rho-cloud/credentials.json", "warning");
      },
    });
    return;
  }

  let pollTimer: NodeJS.Timeout | null = null;
  let lastSeenCount = 0;
  let lastSeenIds: Set<string> = new Set();
  let currentUnread = 0;
  let consecutivePollFailures = 0;

  // ── Status bar ──

  const updateStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const theme = ctx.ui.theme;
    if (currentUnread > 0) {
      ctx.ui.setStatus("email", theme.fg("warning", `✉ ${currentUnread}`));
    } else {
      ctx.ui.setStatus("email", theme.fg("dim", "✉ 0"));
    }
  };

  // ── Polling ──

  const pollInbox = async (ctx: ExtensionContext, silent = true) => {
    try {
      const result = await fetchInbox(creds, "unread", 50);
      if (!result.ok) {
        consecutivePollFailures++;
        if (consecutivePollFailures >= 3 && ctx.hasUI) {
          ctx.ui.setStatus("email", ctx.ui.theme.fg("error", "✉ ERR"));
        }
        return;
      }

      consecutivePollFailures = 0;
      const newCount = result.pagination.total;
      const newIds = new Set(result.data.map((m) => m.id));

      // Detect genuinely new messages (not just ones we haven't processed)
      const brandNew = result.data.filter((m) => !lastSeenIds.has(m.id));

      if (brandNew.length > 0 && lastSeenIds.size > 0) {
        // We had a previous baseline and new mail arrived
        const subjects = brandNew.map((m) => m.subject || "(no subject)").join(", ");
        const senders = [...new Set(brandNew.map((m) => m.sender))].join(", ");
        notify(
          `✉ ${brandNew.length} new email${brandNew.length > 1 ? "s" : ""}`,
          `From: ${senders}\n${subjects}`
        );

        if (!silent && ctx.hasUI) {
          ctx.ui.notify(
            `✉ ${brandNew.length} new: ${subjects}`,
            "info"
          );
        }
      }

      currentUnread = newCount;
      lastSeenCount = newCount;
      lastSeenIds = newIds;
      updateStatus(ctx);
    } catch {
      consecutivePollFailures++;
      if (consecutivePollFailures >= 3 && ctx.hasUI) {
        ctx.ui.setStatus("email", ctx.ui.theme.fg("error", "✉ ERR"));
      }
    }
  };

  const startPolling = (ctx: ExtensionContext) => {
    if (pollTimer) clearInterval(pollTimer);
    // Initial check
    pollInbox(ctx, false);
    // Then every 5 minutes
    pollTimer = setInterval(() => pollInbox(ctx), POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  // ── Lifecycle ──

  pi.on("session_start", async (_event, ctx) => {
    startPolling(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    startPolling(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  // ── Tool ──

  pi.registerTool({
    name: "email",
    label: "Email",
    description:
      `Check and manage the agent inbox (${creds.email}). ` +
      "Actions: check (poll for new mail), list (show messages), read (single message), " +
      "act (mark as acted with log), archive (archive message), send (send an email).",
    parameters: Type.Object({
      action: StringEnum(["check", "list", "read", "act", "archive", "send"] as const),
      id: Type.Optional(Type.String({ description: "Message ID (for read/act/archive)" })),
      to: Type.Optional(Type.String({ description: "Recipient email address (required for send)" })),
      subject: Type.Optional(Type.String({ description: "Email subject (for send)" })),
      body: Type.Optional(Type.String({ description: "Email body text (for send)" })),
      in_reply_to: Type.Optional(Type.String({ description: "Inbox message ID to reply to (for send)" })),
      status: Type.Optional(Type.String({ description: "Filter for list: unread, read, acted, archived (default: unread)" })),
      log: Type.Optional(Type.String({ description: "Action log describing what was done (for act)" })),
      limit: Type.Optional(Type.Number({ description: "Max messages to return (default: 20)" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      switch (params.action) {
        case "check": {
          await pollInbox(ctx, false);
          const result = await fetchInbox(creds, "unread", params.limit || 20);
          if (!result.ok) {
            return { content: [{ type: "text", text: `Error: ${result.error || "API error"}` }] };
          }
          if (result.data.length === 0) {
            return {
              content: [{ type: "text", text: "No unread messages." }],
              details: { unread: 0 },
            };
          }
          return {
            content: [{ type: "text", text: formatMessageList(result.data, result.pagination.total) }],
            details: { unread: result.pagination.total },
          };
        }

        case "list": {
          const status = params.status || "unread";
          const result = await fetchInbox(creds, status, params.limit || 20);
          if (!result.ok) {
            return { content: [{ type: "text", text: `Error: ${result.error || "API error"}` }] };
          }
          return {
            content: [{ type: "text", text: formatMessageList(result.data, result.pagination.total) }],
            details: { count: result.pagination.total, status },
          };
        }

        case "read": {
          if (!params.id) {
            return { content: [{ type: "text", text: "Error: message ID required" }] };
          }
          const result = await fetchMessage(creds, params.id);
          if (!result.ok) {
            return { content: [{ type: "text", text: `Error: ${result.error || "message not found"}` }] };
          }
          // Auto-mark as read when the LLM reads it
          if (result.data.status === "unread") {
            await markMessage(creds, params.id, "read");
          }
          return {
            content: [{ type: "text", text: formatMessage(result.data, true) }],
            details: { message: result.data },
          };
        }

        case "act": {
          if (!params.id) {
            return { content: [{ type: "text", text: "Error: message ID required" }] };
          }
          const log = params.log || "Acted on by agent";
          const result = await markMessage(creds, params.id, "acted", log);
          if (!result.ok) {
            return { content: [{ type: "text", text: `Error: ${(result as any).error || "update failed"}` }] };
          }
          // Refresh count
          await pollInbox(ctx);
          return {
            content: [{ type: "text", text: `Marked as acted: ${params.id}\nLog: ${log}` }],
            details: { id: params.id, status: "acted" },
          };
        }

        case "send": {
          if (!params.to) {
            return { content: [{ type: "text", text: "Error: recipient email required (use 'to' parameter)" }] };
          }
          if (!params.subject && !params.body) {
            return { content: [{ type: "text", text: "Error: subject or body required" }] };
          }
          const sendResult = await sendOutbound(
            creds,
            params.to,
            params.subject || "",
            params.body || "",
            params.in_reply_to,
          );
          if (!sendResult.ok) {
            return {
              content: [{ type: "text", text: `Send failed: ${sendResult.error || "unknown error"}` }],
              details: { error: sendResult.error, tier: sendResult.tier, limit: sendResult.limit },
            };
          }
          return {
            content: [{
              type: "text",
              text: `Sent email to ${params.to}\nSubject: ${params.subject || "(no subject)"}\nOutbox ID: ${sendResult.data!.outbox_id}`,
            }],
            details: { outbox_id: sendResult.data!.outbox_id, status: "sent" },
          };
        }

        case "archive": {
          if (!params.id) {
            return { content: [{ type: "text", text: "Error: message ID required" }] };
          }
          const result = await markMessage(creds, params.id, "archived");
          if (!result.ok) {
            return { content: [{ type: "text", text: `Error: ${(result as any).error || "update failed"}` }] };
          }
          await pollInbox(ctx);
          return {
            content: [{ type: "text", text: `Archived: ${params.id}` }],
            details: { id: params.id, status: "archived" },
          };
        }
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("email ")) + theme.fg("muted", args.action);
      if (args.to) text += ` ${theme.fg("accent", args.to)}`;
      else if (args.id) text += ` ${theme.fg("accent", args.id.slice(0, 12) + "...")}`;
      if (args.subject) text += ` ${theme.fg("dim", `"${args.subject}"`)}`;
      if (args.status) text += ` ${theme.fg("dim", args.status)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as Record<string, unknown> | undefined;
      if (details?.unread !== undefined) {
        const n = details.unread as number;
        return new Text(
          n === 0
            ? theme.fg("dim", "No unread messages")
            : theme.fg("warning", `✉ ${n} unread`),
          0, 0
        );
      }
      if (details?.count !== undefined) {
        return new Text(theme.fg("dim", `${details.count} message(s)`), 0, 0);
      }
      if (details?.status === "sent") {
        return new Text(theme.fg("success", "✓ Sent"), 0, 0);
      }
      if (details?.status === "acted") {
        return new Text(theme.fg("success", "✓ Acted"), 0, 0);
      }
      if (details?.status === "archived") {
        return new Text(theme.fg("dim", "✓ Archived"), 0, 0);
      }
      if (details?.message) {
        const msg = details.message as InboxMessage;
        return new Text(
          theme.fg("muted", `${msg.sender}: ${msg.subject || "(no subject)"}`),
          0, 0
        );
      }
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    },
  });

  // ── Slash command ──

  pi.registerCommand("email", {
    description: "Agent email: list, read <id>, act <id>, check, send <to> <subject>",
    handler: async (args, ctx) => {
      const [subcmd, ...rest] = args.trim().split(/\s+/);
      const arg = rest.join(" ");

      switch (subcmd || "") {
        case "":
        case "status": {
          await pollInbox(ctx, false);
          ctx.ui.notify(
            currentUnread > 0
              ? `✉ ${currentUnread} unread at ${creds.email}`
              : `No unread mail at ${creds.email}`,
            currentUnread > 0 ? "info" : "success"
          );
          break;
        }

        case "check": {
          await pollInbox(ctx, false);
          if (currentUnread > 0) {
            const result = await fetchInbox(creds, "unread", 5);
            if (result.ok && result.data.length > 0) {
              const summary = result.data
                .map((m) => `  ${m.sender}: ${m.subject || "(no subject)"}`)
                .join("\n");
              ctx.ui.notify(`✉ ${currentUnread} unread:\n${summary}`, "info");
            }
          } else {
            ctx.ui.notify("No unread mail", "success");
          }
          break;
        }

        case "list": {
          const status = arg || "unread";
          const result = await fetchInbox(creds, status, 10);
          if (!result.ok) {
            ctx.ui.notify("Failed to fetch inbox", "error");
            return;
          }
          if (result.data.length === 0) {
            ctx.ui.notify(`No ${status} messages`, "info");
            return;
          }
          const lines = result.data.map(
            (m) => `${m.id.slice(0, 12)}  ${m.sender}: ${m.subject || "(no subject)"}`
          );
          ctx.ui.notify(lines.join("\n"), "info");
          break;
        }

        case "read": {
          if (!arg) {
            ctx.ui.notify("Usage: /email read <message-id>", "warning");
            return;
          }
          const result = await fetchMessage(creds, arg);
          if (!result.ok) {
            ctx.ui.notify("Message not found", "error");
            return;
          }
          ctx.ui.notify(formatMessage(result.data, true), "info");
          break;
        }

        case "act": {
          if (!arg) {
            ctx.ui.notify("Usage: /email act <message-id>", "warning");
            return;
          }
          const result = await markMessage(creds, arg, "acted", "Acted via /email command");
          if (!result.ok) {
            ctx.ui.notify("Failed to update message", "error");
            return;
          }
          await pollInbox(ctx);
          ctx.ui.notify(`Marked ${arg} as acted`, "success");
          break;
        }

        case "send": {
          // /email send <recipient> <subject...>
          // Body is entered as the subject for quick sends; use the tool for full emails
          const recipient = rest[0];
          const subject = rest.slice(1).join(" ");
          if (!recipient || !recipient.includes("@")) {
            ctx.ui.notify("Usage: /email send <recipient@email.com> <subject>", "warning");
            return;
          }
          if (!subject) {
            ctx.ui.notify("Usage: /email send <recipient@email.com> <subject>", "warning");
            return;
          }
          const result = await sendOutbound(creds, recipient, subject, "");
          if (!result.ok) {
            ctx.ui.notify(`Send failed: ${result.error || "unknown error"}`, "error");
            return;
          }
          ctx.ui.notify(`Sent to ${recipient}: ${subject}`, "success");
          break;
        }

        default:
          ctx.ui.notify("Usage: /email [status|check|list|read <id>|act <id>|send <to> <subject>]", "warning");
      }
    },
  });
}
