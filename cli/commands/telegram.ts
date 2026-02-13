/**
 * rho telegram — Manage the Telegram worker.
 */

import * as path from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadRuntimeState,
  readTelegramSettings,
  TELEGRAM_CHECK_TRIGGER_PATH,
  TELEGRAM_DIR,
  TELEGRAM_WORKER_LOCK_PATH,
} from "../../extensions/telegram/lib.ts";
import { readTelegramWorkerLockOwner } from "../../extensions/telegram/worker-lock.ts";
import { getTelegramCheckTriggerState, requestTelegramCheckTrigger } from "../../extensions/telegram/check-trigger.ts";
import { renderTelegramStatusText } from "../../extensions/telegram/status.ts";
import { isLeaseStale, readLeaseMeta } from "../../extensions/lib/lease-lock.ts";

const DEFAULT_WORKER_LOCK_STALE_MS = 90_000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getWorkerStatus(): { owner: ReturnType<typeof readTelegramWorkerLockOwner>; stale: boolean } {
  const meta = readLeaseMeta(TELEGRAM_WORKER_LOCK_PATH);
  if (!meta.payload) {
    return { owner: null, stale: false };
  }
  const staleMs = parsePositiveIntEnv("RHO_TELEGRAM_WORKER_LOCK_STALE_MS", DEFAULT_WORKER_LOCK_STALE_MS);
  const stale = isLeaseStale(meta, staleMs, Date.now());
  return { owner: readTelegramWorkerLockOwner(TELEGRAM_WORKER_LOCK_PATH), stale };
}

function formatOwner(owner: ReturnType<typeof readTelegramWorkerLockOwner> | null, stale: boolean): { leadership: string; ownerText: string } {
  if (!owner) {
    return { leadership: "stopped", ownerText: "none" };
  }
  const host = owner.hostname ? ` @${owner.hostname}` : "";
  const staleText = stale ? " (stale)" : "";
  return {
    leadership: stale
      ? `stale lock (pid ${owner.pid}${host})`
      : `worker (pid ${owner.pid}${host})`,
    ownerText: `${owner.pid}${host}${staleText}`,
  };
}

function allowedText(values: number[]): string {
  return values.length === 0 ? "all" : values.join(",");
}

function buildStatusText(): string {
  const settings = readTelegramSettings();
  const runtime = loadRuntimeState();
  const trigger = getTelegramCheckTriggerState(TELEGRAM_CHECK_TRIGGER_PATH, 0);
  const { owner, stale } = getWorkerStatus();
  const formatted = formatOwner(owner, stale);

  return renderTelegramStatusText({
    enabled: settings.enabled,
    mode: settings.mode,
    leadershipText: formatted.leadership,
    pollLockPath: TELEGRAM_WORKER_LOCK_PATH,
    pollLockOwnerText: formatted.ownerText,
    triggerPath: TELEGRAM_CHECK_TRIGGER_PATH,
    triggerPending: trigger.pending,
    triggerRequesterPid: trigger.requesterPid ?? null,
    triggerRequestedAt: trigger.requestedAt ?? null,
    lastCheckRequestAt: trigger.requestedAt ?? null,
    lastCheckConsumeAt: null,
    lastCheckOutcome: null,
    tokenEnv: settings.botTokenEnv,
    lastUpdateId: runtime.last_update_id,
    lastPollAt: runtime.last_poll_at,
    pollFailures: runtime.consecutive_failures,
    sendFailures: 0,
    pendingInbound: 0,
    pendingOutbound: 0,
    allowedChatsText: allowedText(settings.allowedChatIds),
    allowedUsersText: allowedText(settings.allowedUserIds),
  });
}

function parseLogsArgs(args: string[]): { lines: number; follow: boolean; help: boolean } {
  let lines = 50;
  let follow = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--follow" || a === "-f") {
      follow = true;
    } else if (a === "--lines" || a === "-n") {
      const next = args[++i];
      const n = parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) lines = n;
    }
  }

  return { lines, follow, help };
}

function readLogLines(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf-8");
  if (!raw.trim()) return [];
  return raw.split("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showLogs(args: string[]): Promise<void> {
  const opts = parseLogsArgs(args);
  if (opts.help) {
    console.log(`rho telegram logs

Show recent Telegram worker output.

Options:
  -n, --lines N   Number of lines to show (default: 50)
  -f, --follow    Poll for new output every 2 seconds
  -h, --help      Show this help`);
    return;
  }

  const logPath = path.join(TELEGRAM_DIR, "log.jsonl");
  if (!existsSync(logPath)) {
    console.error("Telegram log not found. Start the worker to generate logs.");
    process.exitCode = 1;
    return;
  }

  if (!opts.follow) {
    const lines = readLogLines(logPath);
    const tail = lines.slice(-opts.lines);
    process.stdout.write(tail.join("\n") + "\n");
    return;
  }

  const initial = readLogLines(logPath);
  const initialTail = initial.slice(-opts.lines);
  process.stdout.write(initialTail.join("\n") + "\n");
  let lastContent = initial.join("\n");

  while (true) {
    await sleep(2000);
    const current = readLogLines(logPath);
    const currentText = current.join("\n");
    if (currentText !== lastContent) {
      const oldLines = lastContent.split("\n");
      let newStart = 0;
      if (oldLines.length > 0) {
        const lastOldLine = oldLines[oldLines.length - 1];
        const lastOldIdx = current.lastIndexOf(lastOldLine);
        if (lastOldIdx >= 0) {
          newStart = lastOldIdx + 1;
        }
      }
      const diff = current.slice(newStart).filter((l) => l.trim() !== "");
      if (diff.length > 0) {
        process.stdout.write(diff.join("\n") + "\n");
      }
      lastContent = currentText;
    }
  }
}

async function startWorker(): Promise<void> {
  const settings = readTelegramSettings();
  if (!settings.enabled) {
    console.error("Telegram is disabled in init.toml. Enable [settings.telegram].");
    process.exitCode = 1;
    return;
  }
  if (settings.mode !== "polling") {
    console.error("Telegram worker only runs in polling mode.");
    process.exitCode = 1;
    return;
  }

  const status = getWorkerStatus();
  if (status.owner && !status.stale) {
    console.log(`Telegram worker already running (pid ${status.owner.pid}).`);
    return;
  }

  const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workerTs = path.join(cliDir, "telegramd.ts");
  const workerShim = path.join(cliDir, "telegramd.mjs");

  const insideNodeModules = cliDir.includes("node_modules");
  const nodeMajor = parseInt(process.version.slice(1), 10);
  const canStripTypes = nodeMajor >= 22 && !insideNodeModules;

  const childArgs = canStripTypes
    ? ["--experimental-strip-types", "--no-warnings", workerTs]
    : [workerShim];

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  let started = false;
  for (let i = 0; i < 5; i++) {
    await sleep(500);
    const check = getWorkerStatus();
    if (check.owner && !check.stale) {
      started = true;
      break;
    }
  }

  if (!started) {
    console.error("Failed to start telegram worker (lock not acquired).");
    process.exitCode = 1;
    return;
  }

  const owner = getWorkerStatus().owner;
  const pid = owner?.pid ? `pid ${owner.pid}` : "unknown";
  console.log(`Telegram worker started (${pid}).`);
}

async function stopWorker(): Promise<void> {
  const status = getWorkerStatus();
  if (!status.owner) {
    console.log("Telegram worker is not running.");
    return;
  }

  if (status.stale || !pidAlive(status.owner.pid)) {
    try { unlinkSync(TELEGRAM_WORKER_LOCK_PATH); } catch {}
    console.log("Removed stale telegram worker lock.");
    return;
  }

  try {
    process.kill(status.owner.pid, "SIGTERM");
  } catch {
    console.error("Failed to stop telegram worker (signal failed).");
    process.exitCode = 1;
    return;
  }

  let stopped = false;
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const next = getWorkerStatus();
    if (!next.owner || next.stale || !pidAlive(status.owner.pid)) {
      stopped = true;
      break;
    }
  }

  if (!stopped) {
    console.error("Telegram worker did not stop in time.");
    process.exitCode = 1;
    return;
  }

  console.log("Telegram worker stopped.");
}

async function requestCheck(): Promise<void> {
  const requested = requestTelegramCheckTrigger(TELEGRAM_CHECK_TRIGGER_PATH, {
    requestedAt: Date.now(),
    requesterPid: process.pid,
    requesterRole: "follower",
    source: "cli",
  });

  if (!requested) {
    console.error("Failed to request telegram check.");
    process.exitCode = 1;
    return;
  }

  console.log("Telegram check requested.");
  console.log(buildStatusText());
}

export async function run(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const command = (sub || "status").toLowerCase();

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(`rho telegram

Manage the Telegram worker.

Usage:
  rho telegram start
  rho telegram stop
  rho telegram status
  rho telegram logs [--lines N] [--follow]
  rho telegram check

Options:
  -h, --help   Show this help`);
    return;
  }

  if (command === "start") {
    await startWorker();
    return;
  }

  if (command === "stop") {
    await stopWorker();
    return;
  }

  if (command === "status") {
    console.log(buildStatusText());
    return;
  }

  if (command === "logs") {
    await showLogs(rest);
    return;
  }

  if (command === "check") {
    await requestCheck();
    return;
  }

  console.error(`Unknown telegram subcommand: ${command}`);
  process.exitCode = 1;
}
