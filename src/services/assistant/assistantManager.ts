/**
 * Background orchestrator for the phone assistant.
 *
 * Runs inside the Velo app (like startBackgroundSync) while it's open. Long-polls
 * Telegram, enforces a single-user allow-list, and routes messages through the
 * Claude agent. Credentials never leave the app — the bot token is stored
 * encrypted and only used to talk to Telegram.
 */
import { getSetting, setSetting, getSecureSetting, setSecureSetting } from "@/services/db/settings";
import { sendEmail, createDraft } from "@/services/emailActions";
import {
  getUpdates,
  sendMessage,
  sendTyping,
  getMe,
  answerCallbackQuery,
} from "./telegram";
import type {
  TelegramUpdate,
  TelegramMessage,
  TelegramCallbackQuery,
  InlineKeyboardMarkup,
} from "./telegram";
import { runAgentTurn, type ChatTurn } from "./agent";
import type { StagedReply } from "./tools";

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
/** Replies staged by propose_reply, awaiting a button tap. Keyed by short token. */
const pendingReplies = new Map<string, StagedReply>();
let replyTokenCounter = 0;

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
        if (update.callback_query) {
          await handleCallback(token, allowedUserId, update.callback_query);
        } else if (update.message) {
          await handleMessage(token, allowedUserId, update.message);
        }
      } catch (err) {
        console.error("[assistant] error handling update:", err);
      }
    }
  }
}

async function handleMessage(
  token: string,
  allowedUserId: string | null,
  msg: TelegramMessage,
): Promise<void> {
  if (!msg.text || !msg.from) return;
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
      "Hi! I'm your Velo email assistant. Ask me to summarize mail or draft a reply — e.g. \"reply to Sarah that I'll review by Friday.\" I'll show you the draft with Send / Save / Cancel buttons before anything goes out.",
    );
    return;
  }
  if (text === "/reset") {
    histories.delete(chatId);
    await sendMessage(token, chatId, "Conversation reset.");
    return;
  }

  await sendTyping(token, chatId);

  // Capture any reply the agent stages during this turn.
  let staged: StagedReply | null = null;
  const prior = histories.get(chatId) ?? [];
  const { reply, history } = await runAgentTurn(prior, text, {
    stageReply: (r) => {
      staged = r;
    },
  });
  histories.set(chatId, history.slice(-MAX_HISTORY_TURNS));
  await sendMessage(token, chatId, reply);

  if (staged) await presentDraft(token, chatId, staged);
}

/** Post the staged draft with confirmation buttons. */
async function presentDraft(token: string, chatId: number, reply: StagedReply): Promise<void> {
  const tokenId = `r${++replyTokenCounter}`;
  pendingReplies.set(tokenId, reply);
  const preview = `📧 Reply to ${reply.to.join(", ")}\nSubject: ${reply.subject}\n\n${reply.bodyText}`;
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: "✅ Send", callback_data: `send:${tokenId}` },
        { text: "📝 Save draft", callback_data: `draft:${tokenId}` },
        { text: "❌ Cancel", callback_data: `cancel:${tokenId}` },
      ],
    ],
  };
  await sendMessage(token, chatId, preview, keyboard);
}

async function handleCallback(
  token: string,
  allowedUserId: string | null,
  cq: TelegramCallbackQuery,
): Promise<void> {
  const chatId = cq.message?.chat.id;
  const fromId = String(cq.from.id);
  if (chatId === undefined) return;
  if (allowedUserId && fromId !== allowedUserId) {
    await answerCallbackQuery(token, cq.id);
    return;
  }

  const [action, tokenId] = (cq.data ?? "").split(":");
  const reply = tokenId ? pendingReplies.get(tokenId) : undefined;
  if (!reply) {
    await answerCallbackQuery(token, cq.id, "This draft has expired.");
    await sendMessage(token, chatId, "That draft is no longer available — ask me to draft it again.");
    return;
  }
  pendingReplies.delete(tokenId!);

  if (action === "cancel") {
    await answerCallbackQuery(token, cq.id, "Cancelled");
    await sendMessage(token, chatId, "❌ Discarded.");
    return;
  }

  if (action === "send") {
    await answerCallbackQuery(token, cq.id, "Sending…");
    const res = await sendEmail(reply.accountId, reply.rawBase64Url, reply.threadId);
    await sendMessage(
      token,
      chatId,
      res.success
        ? `✅ Sent to ${reply.to.join(", ")}.`
        : `Couldn't send: ${res.error ?? "unknown error"}. ${res.queued ? "(Queued — will retry when online.)" : ""}`,
    );
    return;
  }

  if (action === "draft") {
    await answerCallbackQuery(token, cq.id, "Saving…");
    const res = await createDraft(reply.accountId, reply.rawBase64Url, reply.threadId);
    await sendMessage(
      token,
      chatId,
      res.success ? "📝 Saved to drafts." : `Couldn't save draft: ${res.error ?? "unknown error"}.`,
    );
    return;
  }

  await answerCallbackQuery(token, cq.id);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
