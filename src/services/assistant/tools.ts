/**
 * Email and calendar tools the assistant agent can call.
 *
 * Read tools query Velo's *local cache* (already synced). The write paths
 * (propose_reply, propose_event) never send/save/create anything on their
 * own — they *stage* a draft for the user to confirm with buttons in
 * Telegram. The actual send/save/create runs only on an explicit tap.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getAllAccounts, getAccount } from "@/services/db/accounts";
import { getThreadsForAccount } from "@/services/db/threads";
import { getMessagesForThread } from "@/services/db/messages";
import { buildRawEmail } from "@/utils/emailBuilder";
import { getCalendarsForAccount, getCalendarById } from "@/services/db/calendars";
import { getCalendarEventsInRangeMulti } from "@/services/db/calendarEvents";
import { hasCalendarSupport } from "@/services/calendar/providerFactory";

/** A reply composed and ready to send/save, awaiting user confirmation. */
export interface StagedReply {
  accountId: string;
  threadId: string;
  to: string[];
  subject: string;
  bodyText: string;
  rawBase64Url: string;
}

/** A calendar event drafted and ready to create, awaiting user confirmation. */
export interface StagedEvent {
  accountId: string;
  calendarDbId: string | null;
  calendarRemoteId: string;
  summary: string;
  description?: string;
  location?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  isAllDay: boolean;
}

export interface AssistantContext {
  /** Called by propose_reply to hand a finished draft to the manager for confirmation. */
  stageReply?: (reply: StagedReply) => void;
  /** Called by propose_event to hand a finished event draft to the manager for confirmation. */
  stageEvent?: (event: StagedEvent) => void;
}

export interface AssistantTool {
  def: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<string>;
}

const REF_SEP = "::";

function toIso(ts: number | null | undefined): string {
  if (!ts) return "unknown";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

async function mailAccounts() {
  const all = await getAllAccounts();
  return all.filter((a) => a.provider !== "caldav");
}

/** Accounts that expose a calendar (Gmail, CalDAV, or a read-only ICS subscription). */
async function calendarAccounts() {
  const all = await getAllAccounts();
  const flags = await Promise.all(all.map(async (a) => [a, await hasCalendarSupport(a.id)] as const));
  return flags.filter(([, ok]) => ok).map(([a]) => a);
}

function splitRef(ref: string): [string, string] | null {
  const idx = ref.indexOf(REF_SEP);
  if (idx === -1) return null;
  return [ref.slice(0, idx), ref.slice(idx + REF_SEP.length)];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const listRecentThreads: AssistantTool = {
  def: {
    name: "list_recent_threads",
    description:
      "List the most recent inbox conversations across the user's mail accounts. " +
      "Returns a compact JSON array; use each item's `ref` with read_thread or propose_reply.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max threads per account (default 10, max 30)." },
      },
    },
  },
  async run(input) {
    const rawLimit = typeof input.limit === "number" ? input.limit : 10;
    const limit = Math.max(1, Math.min(30, rawLimit));
    const accounts = await mailAccounts();
    const out: Array<Record<string, unknown>> = [];
    for (const acct of accounts) {
      const threads = await getThreadsForAccount(acct.id, "INBOX", limit);
      for (const t of threads) {
        out.push({
          ref: `${acct.id}${REF_SEP}${t.id}`,
          account: acct.email,
          from: t.from_name || t.from_address || "unknown",
          subject: t.subject || "(no subject)",
          date: toIso(t.last_message_at),
          unread: t.is_read === 0,
          messages: t.message_count,
          snippet: (t.snippet || "").slice(0, 200),
        });
      }
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (out.length === 0) return "No inbox threads found in the local cache yet.";
    return JSON.stringify(out, null, 2);
  },
};

const readThread: AssistantTool = {
  def: {
    name: "read_thread",
    description:
      "Read the full messages of one conversation. Pass the `ref` from list_recent_threads.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Thread reference in the form accountId::threadId." },
      },
      required: ["ref"],
    },
  },
  async run(input) {
    const parsed = parseRef(String(input.ref ?? ""));
    if (!parsed) return `Invalid ref. Expected accountId::threadId.`;
    const messages = await getMessagesForThread(parsed.accountId, parsed.threadId);
    if (messages.length === 0) return "No messages found for that thread (not cached locally).";
    return messages
      .map((m) =>
        [
          `From: ${m.from_name || ""} <${m.from_address || ""}>`,
          `Date: ${toIso(m.date)}`,
          `Subject: ${m.subject || "(no subject)"}`,
          "",
          (m.body_text || m.snippet || "").trim().slice(0, 4000) ||
            "(no cached body — open in Velo to fetch full content)",
        ].join("\n"),
      )
      .join("\n\n---\n\n");
  },
};

function parseRef(ref: string): { accountId: string; threadId: string } | null {
  const idx = ref.indexOf(REF_SEP);
  if (idx === -1) return null;
  return { accountId: ref.slice(0, idx), threadId: ref.slice(idx + REF_SEP.length) };
}

function buildProposeReply(ctx: AssistantContext): AssistantTool {
  return {
    def: {
      name: "propose_reply",
      description:
        "Draft a reply to a conversation and present it to the user for confirmation. " +
        "This does NOT send — the user gets Send / Save-to-drafts / Cancel buttons and decides. " +
        "Pass the thread `ref` and the full reply text you've written.",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Thread reference (accountId::threadId)." },
          body: { type: "string", description: "The full plain-text reply to send." },
        },
        required: ["ref", "body"],
      },
    },
    async run(input) {
      if (!ctx.stageReply) return "Replying isn't available in this context.";
      const parsed = parseRef(String(input.ref ?? ""));
      if (!parsed) return "Invalid ref. Expected accountId::threadId.";
      const body = String(input.body ?? "").trim();
      if (!body) return "The reply body is empty.";

      const account = await getAccount(parsed.accountId);
      if (!account) return "That account no longer exists.";
      const messages = await getMessagesForThread(parsed.accountId, parsed.threadId);
      if (messages.length === 0) return "Can't reply — that thread isn't cached locally.";

      // Reply to the most recent message not sent by the account owner.
      const owner = account.email.toLowerCase();
      const target =
        [...messages].reverse().find((m) => (m.from_address || "").toLowerCase() !== owner) ??
        messages[messages.length - 1]!;

      const to = [target.reply_to || target.from_address].filter((x): x is string => !!x);
      if (to.length === 0) return "Couldn't determine a recipient for the reply.";

      const baseSubject = target.subject || "(no subject)";
      const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

      const inReplyTo = target.message_id_header || undefined;
      const references =
        [target.references_header, target.message_id_header].filter(Boolean).join(" ") || undefined;

      const from = account.display_name
        ? `${account.display_name} <${account.email}>`
        : account.email;
      const htmlBody = `<div>${escapeHtml(body).replace(/\n/g, "<br>")}</div>`;

      const rawBase64Url = buildRawEmail({
        from,
        to,
        subject,
        htmlBody,
        inReplyTo,
        references,
        threadId: parsed.threadId,
      });

      ctx.stageReply({
        accountId: parsed.accountId,
        threadId: parsed.threadId,
        to,
        subject,
        bodyText: body,
        rawBase64Url,
      });

      return `Draft prepared (to ${to.join(", ")}, subject "${subject}"). The user now has Send / Save / Cancel buttons — do not claim it was sent.`;
    },
  };
}

const listCalendars: AssistantTool = {
  def: {
    name: "list_calendars",
    description:
      "List the user's connected calendars across all accounts. Returns each calendar's `ref` " +
      "(accountId::calendarId), display name, account, whether it's primary, and whether it's " +
      "read-only (a URL subscription — can't add events there). Use a `ref` with propose_event " +
      "to target a specific calendar.",
    input_schema: { type: "object", properties: {} },
  },
  async run() {
    const accounts = await calendarAccounts();
    if (accounts.length === 0) return "No calendar accounts connected.";
    const out: Array<Record<string, unknown>> = [];
    for (const acct of accounts) {
      const cals = await getCalendarsForAccount(acct.id);
      for (const cal of cals) {
        out.push({
          ref: `${acct.id}${REF_SEP}${cal.id}`,
          account: acct.display_name || acct.email,
          name: cal.display_name ?? "Calendar",
          primary: !!cal.is_primary,
          readOnly: acct.provider === "ics_url",
        });
      }
    }
    if (out.length === 0) return "No calendars found yet — they sync shortly after connecting an account.";
    return JSON.stringify(out, null, 2);
  },
};

const listCalendarEvents: AssistantTool = {
  def: {
    name: "list_calendar_events",
    description:
      "List calendar events across all connected calendars within a date range. Defaults to " +
      "today through the next 7 days if start/end aren't given. Dates are ISO 8601 " +
      "(e.g. 2026-07-08 or 2026-07-08T00:00:00). Use this to answer questions about what's on " +
      "the calendar and to summarize upcoming events.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Start of range, ISO 8601. Defaults to the start of today." },
        end: { type: "string", description: "End of range, ISO 8601. Defaults to 7 days after start." },
      },
    },
  },
  async run(input) {
    const now = new Date();
    const startDate = input.start
      ? new Date(String(input.start))
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (isNaN(startDate.getTime())) return "Invalid start date.";
    const endDate = input.end
      ? new Date(String(input.end))
      : new Date(startDate.getTime() + 7 * 86400 * 1000);
    if (isNaN(endDate.getTime())) return "Invalid end date.";

    const startTs = Math.floor(startDate.getTime() / 1000);
    const endTs = Math.floor(endDate.getTime() / 1000);

    const accounts = await calendarAccounts();
    if (accounts.length === 0) return "No calendar accounts connected.";

    const out: Array<Record<string, unknown>> = [];
    for (const acct of accounts) {
      const cals = await getCalendarsForAccount(acct.id);
      const visibleIds = cals.filter((c) => c.is_visible).map((c) => c.id);
      const events = await getCalendarEventsInRangeMulti(acct.id, visibleIds, startTs, endTs);
      const calById = new Map(cals.map((c) => [c.id, c]));
      for (const e of events) {
        const cal = e.calendar_id ? calById.get(e.calendar_id) : undefined;
        out.push({
          summary: e.summary || "(no title)",
          start: toIso(e.start_time),
          end: toIso(e.end_time),
          allDay: !!e.is_all_day,
          location: e.location || undefined,
          calendar: cal?.display_name ?? "Calendar",
          account: acct.display_name || acct.email,
        });
      }
    }
    out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    if (out.length === 0) return "No events found in that range.";
    return JSON.stringify(out, null, 2);
  },
};

function buildProposeEvent(ctx: AssistantContext): AssistantTool {
  return {
    def: {
      name: "propose_event",
      description:
        "Draft a new calendar event and present it to the user for confirmation. This does NOT " +
        "create the event — the user gets Add / Cancel buttons and decides. Pass a calendar `ref` " +
        "from list_calendars to target a specific calendar (optional — defaults to the first " +
        "writable calendar). Times are ISO 8601 with a timezone offset or Z, e.g. " +
        "2026-07-08T15:00:00Z.",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Calendar reference (accountId::calendarId) from list_calendars. Optional." },
          summary: { type: "string", description: "Event title." },
          description: { type: "string", description: "Event description (optional)." },
          location: { type: "string", description: "Event location (optional)." },
          startTime: { type: "string", description: "Start time, ISO 8601." },
          endTime: { type: "string", description: "End time, ISO 8601." },
          isAllDay: { type: "boolean", description: "Whether this is an all-day event (optional, default false)." },
        },
        required: ["summary", "startTime", "endTime"],
      },
    },
    async run(input) {
      if (!ctx.stageEvent) return "Adding events isn't available in this context.";
      const summary = String(input.summary ?? "").trim();
      if (!summary) return "Event needs a title.";
      const startTime = String(input.startTime ?? "");
      const endTime = String(input.endTime ?? "");
      if (isNaN(new Date(startTime).getTime()) || isNaN(new Date(endTime).getTime())) {
        return "Invalid startTime/endTime — use ISO 8601 format.";
      }

      let targetAccountId: string | undefined;
      let calendarDbId: string | null = null;
      let calendarRemoteId = "primary";

      if (input.ref) {
        const parsed = splitRef(String(input.ref));
        if (!parsed) return "Invalid calendar ref. Expected accountId::calendarId.";
        const [refAccountId, calendarId] = parsed;
        const cal = await getCalendarById(calendarId);
        if (!cal || cal.account_id !== refAccountId) return "That calendar wasn't found.";
        const account = await getAccount(refAccountId);
        if (account?.provider === "ics_url") return "That calendar is read-only (a URL subscription) — pick a different one.";
        targetAccountId = refAccountId;
        calendarDbId = cal.id;
        calendarRemoteId = cal.remote_id;
      } else {
        // Default: primary calendar of the first writable (non-read-only) connected account.
        const accounts = await calendarAccounts();
        for (const acct of accounts) {
          if (acct.provider === "ics_url") continue;
          const cals = await getCalendarsForAccount(acct.id);
          const primary = cals.find((c) => c.is_primary) ?? cals[0];
          if (primary) {
            targetAccountId = acct.id;
            calendarDbId = primary.id;
            calendarRemoteId = primary.remote_id;
            break;
          }
        }
      }

      if (!targetAccountId) return "No writable calendar available to add this event to.";

      ctx.stageEvent({
        accountId: targetAccountId,
        calendarDbId,
        calendarRemoteId,
        summary,
        description: input.description ? String(input.description) : undefined,
        location: input.location ? String(input.location) : undefined,
        startTime,
        endTime,
        isAllDay: input.isAllDay === true,
      });

      return `Event drafted: "${summary}" (${startTime} to ${endTime}). The user now has Add / Cancel buttons — do not claim it was created.`;
    },
  };
}

/** Build the tool set. Pass a context to enable the reply/event (write) paths. */
export function buildTools(ctx: AssistantContext = {}): AssistantTool[] {
  return [
    listRecentThreads,
    readThread,
    buildProposeReply(ctx),
    listCalendars,
    listCalendarEvents,
    buildProposeEvent(ctx),
  ];
}
