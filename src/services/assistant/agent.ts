/**
 * Claude tool-use loop for the email assistant.
 *
 * Reuses the app's configured Claude API key (`claude_api_key`) and model
 * (`claude_model`). History passed in/out is intentionally "clean" — only the
 * user/assistant *text* turns are persisted; the intermediate tool_use/
 * tool_result blocks live only inside one call, which keeps cross-turn history
 * trivial to trim without breaking tool_use↔tool_result pairing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getSecureSetting, getSetting } from "@/services/db/settings";
import { buildTools, type AssistantContext } from "./tools";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_STEPS = 8;

function buildSystemPrompt(now: Date): string {
  return `You are Velo's email and calendar assistant, reached by the user over a Telegram chat from their phone.

Current date/time: ${now.toISOString()} (${now.toLocaleDateString(undefined, { weekday: "long" })}). Use this to resolve relative dates like "today", "tomorrow", or "next Friday".

Tools:
- list_recent_threads — see recent inbox conversations
- read_thread — read the full messages of one conversation
- propose_reply — draft a reply and show it to the user for confirmation
- list_calendars — see the user's connected calendars
- list_calendar_events — see events in a date range (defaults to the next 7 days)
- propose_event — draft a new calendar event and show it to the user for confirmation

Replying: when the user wants to reply, read the relevant thread first so you have the context, write a complete reply in their voice, then call propose_reply with the thread ref and your drafted body. propose_reply does NOT send — the user gets Send / Save-to-drafts / Cancel buttons and decides. Never claim a message was sent; after proposing, just say you've drafted it and they can review the buttons. You cannot send directly, archive, or delete.

Calendar: use list_calendar_events to answer questions about what's on the calendar, and summarize concisely rather than dumping raw data. When the user asks to add or schedule something, resolve relative dates/times using the current date/time above, then call propose_event. propose_event does NOT create the event — the user gets Add / Cancel buttons and decides. Never claim an event was created; after proposing, just say you've drafted it. If the user has more than one calendar and it's unclear which they mean, call list_calendars and ask.

Style: you're on a phone. Be concise and skimmable. Lead with the answer. Use short lines, not walls of text. When listing emails or events, give the key facts plus a one-line gist, newest/soonest first. Don't dump raw JSON at the user.`;
}

export async function runAgentTurn(
  history: ChatTurn[],
  userText: string,
  ctx: AssistantContext = {},
): Promise<{ reply: string; history: ChatTurn[] }> {
  const apiKey = await getSecureSetting("claude_api_key");
  if (!apiKey) {
    return {
      reply:
        "AI isn't configured yet. Add your Anthropic API key in Velo → Settings → AI, then try again.",
      history,
    };
  }
  const model = (await getSetting("claude_model")) ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const tools = buildTools(ctx);
  const toolDefs = tools.map((t) => t.def);

  // Working message list for this turn (includes ephemeral tool blocks).
  const working: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userText },
  ];

  let replyText = "";
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: buildSystemPrompt(new Date()),
      tools: toolDefs,
      messages: working,
    });
    working.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const tool = tools.find((t) => t.def.name === block.name);
        let output: string;
        try {
          output = tool
            ? await tool.run(block.input as Record<string, unknown>)
            : `Unknown tool: ${block.name}`;
        } catch (err) {
          output = `Error running ${block.name}: ${err instanceof Error ? err.message : String(err)}`;
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: output });
      }
      working.push({ role: "user", content: results });
      continue;
    }

    // Terminal turn — collect text.
    replyText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    break;
  }

  if (!replyText) replyText = "Sorry — I couldn't complete that. Try rephrasing?";

  // Persist only the clean text turns.
  const newHistory: ChatTurn[] = [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: replyText },
  ];
  return { reply: replyText, history: newHistory };
}
