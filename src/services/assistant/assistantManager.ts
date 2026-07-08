/**
 * Background orchestrator for the phone assistant.
 *
 * Runs inside the Velo app (like startBackgroundSync) while it's open. Long-polls
 * Telegram, enforces a single-user allow-list, and routes messages through the
 * Claude agent. Credentials never leave the app — the bot token is stored
 * encrypted and only used to talk to Telegram.
 */
import { info, warn, error as pluginLogError } from "@tauri-apps/plugin-log";
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
import type { StagedReply, StagedEvent } from "./tools";
import { createAndCacheCalendarEvent } from "@/services/calendar/calendarActions";

const POLL_TIMEOUT_SEC = 30;
const ERROR_BACKOFF_MS = 3000;
const MAX_HISTORY_TURNS = 20;

// Frontend console.log/warn/error only show up in the WebView devtools console,
// not the terminal running `npm run tauri dev` — these also forward to the
// Rust `log` crate (via the log plugin), which prints to stdout, so assistant
// activity is visible in the terminal too. Logging failures are swallowed;
// they must never break message handling.
function log(message: string): void {
  console.log(message);
  void info(message).catch(() => {});
}
function logWarn(message: string, err?: unknown): void {
  console.warn(message, err ?? "");
  void warn(err ? `${message} ${String(err)}` : message).catch(() => {});
}
function logErr(message: string, err?: unknown): void {
  console.error(message, err ?? "");
  void pluginLogError(err ? `${message} ${String(err)}` : message).catch(() => {});
}

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
/** Events staged by propose_event, awaiting a button tap. Keyed by short token. */
const pendingEvents = new Map<string, StagedEvent>();
let eventTokenCounter = 0;

export function isAssistantRunning(): boolean {
  return running;
}

// ---------------------------------------------------------------------------
// Live status — lets the Settings UI show whether the assistant is actually
// polling, vs. just "enabled" in config (which says nothing about whether it
// started successfully, e.g. a bad token fails silently into a retry loop).
// ---------------------------------------------------------------------------

export type AssistantStatus = "stopped" | "running" | "error";
export type AssistantStatusCallback = (status: AssistantStatus, detail?: string) => void;

let statusCallback: AssistantStatusCallback | null = null;
let currentStatus: AssistantStatus = "stopped";
let currentDetail: string | undefined;

function setStatus(status: AssistantStatus, detail?: string): void {
  if (status === currentStatus && detail === currentDetail) return;
  currentStatus = status;
  currentDetail = detail;
  statusCallback?.(status, detail);
}

export function getAssistantStatus(): { status: AssistantStatus; detail?: string } {
  return { status: currentStatus, detail: currentDetail };
}

/** Subscribe to status changes; immediately invoked with the current status. */
export function onAssistantStatus(cb: AssistantStatusCallback): () => void {
  statusCallback = cb;
  cb(currentStatus, currentDetail);
  return () => {
    statusCallback = null;
  };
}

export async function startAssistant(): Promise<void> {
  if (running) return;
  const cfg = await getAssistantConfig();
  if (!cfg.enabled) {
    log("[assistant] not starting — disabled in settings");
    setStatus("stopped", "Disabled in settings");
    return;
  }
  if (!cfg.token) {
    log("[assistant] not starting — no bot token configured");
    setStatus("stopped", "No bot token configured");
    return;
  }

  running = true;
  log("[assistant] started, polling Telegram for updates");
  setStatus("running");
  void pollLoop(cfg.token, cfg.allowedUserId);
}

export function stopAssistant(): void {
  if (!running) return;
  running = false;
  controller?.abort();
  controller = null;
  histories.clear();
  log("[assistant] stopped");
  setStatus("stopped");
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
      setStatus("running");
    } catch (err) {
      if (!running) break; // aborted on shutdown
      const message = err instanceof Error ? err.message : String(err);
      logWarn("[assistant] getUpdates failed, backing off:", err);
      setStatus("error", message);
      await delay(ERROR_BACKOFF_MS);
      continue;
    }
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      log(`[assistant] received update: ${JSON.stringify(update)}`);
      try {
        if (update.callback_query) {
          await handleCallback(token, allowedUserId, update.callback_query);
        } else if (update.message) {
          await handleMessage(token, allowedUserId, update.message);
        }
      } catch (err) {
        logErr("[assistant] error handling update:", err);
      }
    }
  }
}

async function handleMessage(
  token: string,
  allowedUserId: string | null,
  msg: TelegramMessage,
): Promise<void> {
  if (!msg.text || !msg.from) {
    log(`[assistant] ignoring message with no text/from: ${JSON.stringify(msg)}`);
    return;
  }
  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const text = msg.text.trim();

  log(`[assistant] message from user ${fromId} (chat ${chatId}): ${text}`);

  // Allow-list. If unset, help the owner discover their ID; otherwise ignore strangers.
  if (!allowedUserId) {
    log("[assistant] no allowed user configured yet — replying with ID and returning");
    await sendMessage(
      token,
      chatId,
      `Your Telegram user ID is ${fromId}.\nAdd it as the allowed user in Velo → Settings → Assistant to authorize this chat.`,
    );
    return;
  }
  if (fromId !== allowedUserId) {
    log(`[assistant] ignoring message from unauthorized user ${fromId} (allowed: ${allowedUserId})`);
    return;
  }

  if (text === "/start") {
    log(`[assistant] handling /start for chat ${chatId}`);
    await sendMessage(
      token,
      chatId,
      "Hi! I'm your Velo assistant. Ask me to summarize mail, draft a reply, check your calendar, or add an event — e.g. \"reply to Sarah that I'll review by Friday\" or \"what's on my calendar tomorrow?\" I'll show you drafts and new events with confirmation buttons before anything goes out or gets added.",
    );
    return;
  }
  if (text === "/reset") {
    log(`[assistant] resetting conversation history for chat ${chatId}`);
    histories.delete(chatId);
    await sendMessage(token, chatId, "Conversation reset.");
    return;
  }

  log(`[assistant] processing message from chat ${chatId} via agent…`);
  await sendTyping(token, chatId);

  // Capture any reply/event the agent stages during this turn.
  let staged: StagedReply | null = null;
  let stagedEvent: StagedEvent | null = null;
  const prior = histories.get(chatId) ?? [];
  const { reply, history } = await runAgentTurn(prior, text, {
    stageReply: (r) => {
      staged = r;
    },
    stageEvent: (e) => {
      stagedEvent = e;
    },
  });
  histories.set(chatId, history.slice(-MAX_HISTORY_TURNS));
  log(`[assistant] agent replied to chat ${chatId}, sending response`);
  await sendMessage(token, chatId, reply);

  if (staged) await presentDraft(token, chatId, staged);
  if (stagedEvent) await presentEventDraft(token, chatId, stagedEvent);
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

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Post the staged event with confirmation buttons. */
async function presentEventDraft(token: string, chatId: number, event: StagedEvent): Promise<void> {
  const tokenId = `e${++eventTokenCounter}`;
  pendingEvents.set(tokenId, event);
  const when = event.isAllDay
    ? `${formatEventTime(event.startTime)} (all day)`
    : `${formatEventTime(event.startTime)} – ${formatEventTime(event.endTime)}`;
  const preview = `📅 ${event.summary}\n${when}${event.location ? `\n📍 ${event.location}` : ""}`;
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: "✅ Add", callback_data: `event_create:${tokenId}` },
        { text: "❌ Cancel", callback_data: `event_cancel:${tokenId}` },
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
  log(`[assistant] callback from user ${fromId} (chat ${chatId ?? "?"}): ${cq.data ?? "(no data)"}`);
  if (chatId === undefined) return;
  if (allowedUserId && fromId !== allowedUserId) {
    log(`[assistant] ignoring callback from unauthorized user ${fromId} (allowed: ${allowedUserId})`);
    await answerCallbackQuery(token, cq.id);
    return;
  }

  const [action, tokenId] = (cq.data ?? "").split(":");

  if (action === "event_create" || action === "event_cancel") {
    const event = tokenId ? pendingEvents.get(tokenId) : undefined;
    if (!event) {
      log(`[assistant] callback references expired/unknown event token ${tokenId ?? "(none)"}`);
      await answerCallbackQuery(token, cq.id, "This event draft has expired.");
      await sendMessage(token, chatId, "That event draft is no longer available — ask me to draft it again.");
      return;
    }
    pendingEvents.delete(tokenId!);

    if (action === "event_cancel") {
      log(`[assistant] discarding staged event for chat ${chatId}`);
      await answerCallbackQuery(token, cq.id, "Cancelled");
      await sendMessage(token, chatId, "❌ Discarded.");
      return;
    }

    log(`[assistant] creating staged event for chat ${chatId}`);
    await answerCallbackQuery(token, cq.id, "Adding…");
    try {
      await createAndCacheCalendarEvent(event.accountId, event.calendarRemoteId, event.calendarDbId, {
        summary: event.summary,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
      });
      log(`[assistant] event created for chat ${chatId}`);
      await sendMessage(token, chatId, `✅ Added "${event.summary}" to your calendar.`);
    } catch (err) {
      logErr(`[assistant] failed to create event for chat ${chatId}:`, err);
      await sendMessage(
        token,
        chatId,
        `Couldn't add the event: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  const reply = tokenId ? pendingReplies.get(tokenId) : undefined;
  if (!reply) {
    log(`[assistant] callback references expired/unknown draft token ${tokenId ?? "(none)"}`);
    await answerCallbackQuery(token, cq.id, "This draft has expired.");
    await sendMessage(token, chatId, "That draft is no longer available — ask me to draft it again.");
    return;
  }
  pendingReplies.delete(tokenId!);

  if (action === "cancel") {
    log(`[assistant] discarding staged reply for chat ${chatId}`);
    await answerCallbackQuery(token, cq.id, "Cancelled");
    await sendMessage(token, chatId, "❌ Discarded.");
    return;
  }

  if (action === "send") {
    log(`[assistant] sending staged reply for chat ${chatId}`);
    await answerCallbackQuery(token, cq.id, "Sending…");
    const res = await sendEmail(reply.accountId, reply.rawBase64Url, reply.threadId);
    log(`[assistant] send result for chat ${chatId}: ${res.success ? "success" : `failed — ${res.error ?? "unknown error"}`}`);
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
    log(`[assistant] saving staged reply as draft for chat ${chatId}`);
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
