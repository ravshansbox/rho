import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const HOME = process.env.HOME || homedir();
const LOG_PATH = join(HOME, ".rho", "telegram", "log.jsonl");

function normalizeLogEvent(input: Record<string, unknown>): Record<string, unknown> {
  const { type: _legacyType, event, ...rest } = input;
  const normalizedEvent = typeof event === "string" && event.trim().length > 0
    ? event
    : "unknown";

  return {
    source: "telegram",
    schema_version: 1,
    event: normalizedEvent,
    ...rest,
  };
}

export function appendTelegramLog(event: Record<string, unknown>, logPath: string = LOG_PATH): void {
  mkdirSync(dirname(logPath), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...normalizeLogEvent(event) });
  appendFileSync(logPath, line + "\n");
}
