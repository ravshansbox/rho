const MAX_TELEGRAM_TEXT = 4096;

export function renderOutboundText(text: string): string {
  return (text || "").trim() || "(empty response)";
}

export function chunkTelegramText(text: string, maxLen = MAX_TELEGRAM_TEXT): string[] {
  const normalized = renderOutboundText(text);
  if (normalized.length <= maxLen) return [normalized];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.4)) {
      cut = rest.lastIndexOf(" ", maxLen);
    }
    if (cut < Math.floor(maxLen * 0.4)) {
      cut = maxLen;
    }

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);

  return chunks;
}
