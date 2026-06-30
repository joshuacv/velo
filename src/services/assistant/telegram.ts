/**
 * Minimal Telegram Bot API client (fetch-based, long-polling).
 *
 * The bot connects *out* to Telegram (no inbound port), so it works behind NAT
 * as long as Velo is running. `api.telegram.org` must be allowed in the app CSP
 * (`connect-src` in tauri.conf.json).
 */

const API_BASE = "https://api.telegram.org";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  const data = (await res.json()) as TelegramResponse<T>;
  if (!data.ok || data.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
  }
  return data.result;
}

/** Validate a bot token and return the bot's identity (used by Settings "Test"). */
export function getMe(token: string): Promise<TelegramUser> {
  return call<TelegramUser>(token, "getMe");
}

/**
 * Long-poll for new updates. Holds the connection open up to `timeoutSec`
 * server-side; pass an AbortSignal to cancel cleanly on shutdown.
 */
export function getUpdates(
  token: string,
  offset: number,
  timeoutSec: number,
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>(
    token,
    "getUpdates",
    { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] },
    signal,
  );
}

/** Telegram caps a single message at 4096 chars — split long replies. */
function chunk(text: string, size = 4000): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const parts = chunk(text);
  for (let i = 0; i < parts.length; i++) {
    const params: Record<string, unknown> = { chat_id: chatId, text: parts[i] };
    // Attach buttons only to the final chunk.
    if (replyMarkup && i === parts.length - 1) params.reply_markup = replyMarkup;
    await call(token, "sendMessage", params);
  }
}

/** Acknowledge a button tap (stops the client-side loading spinner). */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  try {
    await call(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  } catch {
    /* non-critical */
  }
}

/** Best-effort "typing…" indicator; failures are ignored. */
export async function sendTyping(token: string, chatId: number): Promise<void> {
  try {
    await call(token, "sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* non-critical */
  }
}
