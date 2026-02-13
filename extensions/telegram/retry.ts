import { TelegramApiError } from "./api.ts";

export function shouldRetryTelegramError(error: unknown, attempt: number, maxAttempts = 3): boolean {
  if (attempt >= maxAttempts) return false;
  if (!(error instanceof TelegramApiError)) return false;
  if (error.status === 429) return true;
  if (error.status >= 500) return true;
  return false;
}

export function retryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof TelegramApiError && typeof error.retryAfterSeconds === "number") {
    return Math.max(0, error.retryAfterSeconds * 1000);
  }
  const base = 1000;
  return Math.min(30_000, base * Math.pow(2, Math.max(0, attempt)));
}
