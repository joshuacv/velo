/**
 * Read-only email tools the assistant agent can call.
 *
 * Slice 1 is intentionally read-only: it queries Velo's *local cache* (already
 * synced) rather than hitting the network, and exposes no actions that can
 * modify or send mail. Reply/send arrives in slice 2 behind a confirmation gate.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getAllAccounts } from "@/services/db/accounts";
import { getThreadsForAccount } from "@/services/db/threads";
import { getMessagesForThread } from "@/services/db/messages";

export interface AssistantTool {
  def: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<string>;
}

const REF_SEP = "::";

/** Epoch values in the cache are sometimes seconds, sometimes ms — normalize. */
function toIso(ts: number | null | undefined): string {
  if (!ts) return "unknown";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/** Mail accounts only (skip calendar/caldav accounts). */
async function mailAccounts() {
  const all = await getAllAccounts();
  return all.filter((a) => a.provider !== "caldav");
}

const listRecentThreads: AssistantTool = {
  def: {
    name: "list_recent_threads",
    description:
      "List the most recent inbox conversations across the user's mail accounts. " +
      "Returns a compact JSON array; use each item's `ref` with read_thread to open it.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max threads per account (default 10, max 30).",
        },
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
        ref: {
          type: "string",
          description: "Thread reference in the form accountId::threadId.",
        },
      },
      required: ["ref"],
    },
  },
  async run(input) {
    const ref = String(input.ref ?? "");
    const sepIdx = ref.indexOf(REF_SEP);
    if (sepIdx === -1) return `Invalid ref: ${ref}. Expected accountId::threadId.`;
    const accountId = ref.slice(0, sepIdx);
    const threadId = ref.slice(sepIdx + REF_SEP.length);
    const messages = await getMessagesForThread(accountId, threadId);
    if (messages.length === 0) return "No messages found for that thread (not cached locally).";

    const rendered = messages.map((m) => {
      const body = (m.body_text || m.snippet || "").trim().slice(0, 4000);
      return [
        `From: ${m.from_name || ""} <${m.from_address || ""}>`,
        `Date: ${toIso(m.date)}`,
        `Subject: ${m.subject || "(no subject)"}`,
        "",
        body || "(no cached body — open in Velo to fetch full content)",
      ].join("\n");
    });
    return rendered.join("\n\n---\n\n");
  },
};

/** All read-only tools available to the agent in slice 1. */
export function buildTools(): AssistantTool[] {
  return [listRecentThreads, readThread];
}
