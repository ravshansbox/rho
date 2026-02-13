#!/usr/bin/env node

import { runTelegramWorker } from "../extensions/telegram/worker.ts";

try {
  runTelegramWorker();
} catch (error) {
  const msg = (error as Error)?.message || String(error);
  console.error(`Telegram worker failed: ${msg}`);
  process.exit(1);
}
