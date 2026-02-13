export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface GetUpdatesParams {
  offset?: number;
  timeout?: number;
  allowed_updates?: string[];
}

export interface SendMessageParams {
  chat_id: number;
  text: string;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

export interface SendChatActionParams {
  chat_id: number;
  action: "typing" | "upload_photo" | "record_video" | "upload_video" | "record_voice" | "upload_voice" | "upload_document" | "choose_sticker" | "find_location" | "record_video_note" | "upload_video_note";
}

export class TelegramApiError extends Error {
  public readonly status: number;
  public readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(token: string, baseUrl = "https://api.telegram.org") {
    this.baseUrl = `${baseUrl}/bot${token}`;
  }

  async getUpdates(params: GetUpdatesParams): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset: params.offset,
      timeout: params.timeout,
      allowed_updates: params.allowed_updates,
    });
  }

  async sendMessage(params: SendMessageParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", params);
  }

  async sendChatAction(params: SendChatActionParams): Promise<boolean> {
    return this.call<boolean>("sendChatAction", params);
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let json: TelegramApiResponse<T> | null = null;
    try {
      json = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      throw new TelegramApiError(`Telegram ${method} failed: invalid JSON response`, response.status || 500);
    }

    if (!response.ok || !json.ok || json.result === undefined) {
      const retryAfter = json.parameters?.retry_after;
      const msg = json.description || `Telegram ${method} failed with status ${response.status}`;
      throw new TelegramApiError(msg, response.status || json.error_code || 500, retryAfter);
    }

    return json.result;
  }
}
