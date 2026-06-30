/**
 * Email tools the assistant agent can call.
 *
 * Read tools query Velo's *local cache* (already synced). The write path
 * (propose_reply) never sends or saves on its own — it *stages* a reply for the
 * user to confirm with buttons in Telegram. Actual send/save runs only on an
 * explicit tap, through Velo's offline-aware emailActions.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getAllAccounts, getAccount } from "@/services/db/accounts";
import { getThreadsForAccount } from "@/services/db/threads";
import { getMessagesForThread } from "@/services/db/messages";
import { buildRawEmail } from "@/utils/emailBuilder";

/** A reply composed and ready to send/save, awaiting user confirmation. */
export interface StagedReply {
  accountId: string;
  threadId: string;
  to: string[];
  subject: string;
  bodyText: string;
  rawBase64Url: string;
}

export interface AssistantContext {
  /** Called by propose_reply to hand a finished draft to the manager for confirmation. */
  stageReply?: (reply: StagedReply) => void;
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

/** Build the tool set. Pass a context to enable the reply (write) path. */
export function buildTools(ctx: AssistantContext = {}): AssistantTool[] {
  return [listRecentThreads, readThread, buildProposeReply(ctx)];
}
