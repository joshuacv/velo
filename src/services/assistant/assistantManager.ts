/**
 * Background orchestrator for the phone assistant.
 *
 * Runs inside the Velo app (like startBackgroundSync) while it's open. Long-polls
 * Telegram, enforces a single-user allow-list, and routes messages through the
 * Claude agent. Credentials never leave the app — the bot token is stored
 * encrypted and only used to talk to Telegram.
 */
import { getSetting, setSetting, getSecureSetting, setSecureSetting } from "@/services/db/settings";
import { getUpdates, sendMessage, sendTyping, getMe } from "./telegram";
import type { TelegramUpdate } from "./telegram";
import { runAgentTurn, type ChatTurn } from "./agent";

const POLL_TIMEOUT_SEC = 30;
const ERROR_BACKOFF_MS = 3000;
const MAX_HISTORY_TURNS = 20;

export interface AssistantConfig {
  enabled: boolean;
  token: string | null;
  allowedUserId: string | null;
}

export async function getAssistantConfig(): Promise<AssistantConfig> {
  return {
    enabled: (await getSetting("assistant_enabled")) === "true",
    token: await getSecureSetting("telegram_bot_token"),
    allowedUserId: await getSetting("telegram_allowed_user_id"),
  };
}

export async function saveAssistantConfig(cfg: {
  enabled: boolean;
  token: string;
  allowedUserId: string;
}): Promise<void> {
  await setSetting("assistant_enabled", cfg.enabled ? "true" : "false");
  await setSecureSetting("telegram_bot_token", cfg.token.trim());
  await setSetting("telegram_allowed_user_id", cfg.allowedUserId.trim());
}

/** Validate a token against Telegram and return the bot's @username. */
export async function testToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const me = await getMe(token.trim());
    return { ok: true, username: me.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

let running = false;
let controller: AbortController | null = null;
const histories = new Map<number, ChatTurn[]>();

export function isAssistantRunning(): boolean {
  return running;
}

export async function startAssistant(): Promise<void> {
  if (running) return;
  const cfg = await getAssistantConfig();
  if (!cfg.enabled || !cfg.token) return;

  running = true;
  console.log("[assistant] started");
  void pollLoop(cfg.token, cfg.allowedUserId);
}

export function stopAssistant(): void {
  if (!running) return;
  running = false;
  controller?.abort();
  controller = null;
  histories.clear();
  console.log("[assistant] stopped");
}

/** Apply config changes immediately. */
export async function restartAssistant(): Promise<void> {
  stopAssistant();
  await startAssistant();
}

async function pollLoop(token: string, allowedUserId: string | null): Promise<void> {
  let offset = 0;
  while (running) {
    controller = new AbortController();
    let updates: TelegramUpdate[] = [];
    try {
      updates = await getUpdates(token, offset, POLL_TIMEOUT_SEC, controller.signal);
    } catch (err) {
      if (!running) break; // aborted on shutdown
      console.warn("[assistant] getUpdates failed, backing off:", err);
      await delay(ERROR_BACKOFF_MS);
      continue;
    }
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      try {
        await handleUpdate(token, allowedUserId, update);
      } catch (err) {
        console.error("[assistant] error handling update:", err);
      }
    }
  }
}

async function handleUpdate(
  token: string,
  allowedUserId: string | null,
  update: TelegramUpdate,
): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const text = msg.text.trim();

  // Allow-list. If unset, help the owner discover their ID; otherwise ignore strangers.
  if (!allowedUserId) {
    await sendMessage(
      token,
      chatId,
      `Your Telegram user ID is ${fromId}.\nAdd it as the allowed user in Velo → Settings → Assistant to authorize this chat.`,
    );
    return;
  }
  if (fromId !== allowedUserId) return; // silently ignore unauthorized senders

  if (text === "/start") {
    await sendMessage(
      token,
      chatId,
      "Hi! I'm your Velo email assistant. Ask me things like \"any important email today?\" or \"summarize the latest from Sarah.\"\n\n(Read-only for now — I can read and summarize, but not send yet.)",
    );
    return;
  }
  if (text === "/reset") {
    histories.delete(chatId);
    await sendMessage(token, chatId, "Conversation reset.");
    return;
  }

  await sendTyping(token, chatId);
  const prior = histories.get(chatId) ?? [];
  const { reply, history } = await runAgentTurn(prior, text);
  histories.set(chatId, history.slice(-MAX_HISTORY_TURNS));
  await sendMessage(token, chatId, reply);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
