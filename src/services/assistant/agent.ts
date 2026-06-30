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
import { buildTools } from "./tools";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_STEPS = 8;

const SYSTEM_PROMPT = `You are Velo's email assistant, reached by the user over a Telegram chat from their phone.

You can:
- list_recent_threads — see recent inbox conversations
- read_thread — read the full messages of one conversation

Right now you are READ-ONLY: you can read and summarize mail, but you cannot send, reply to, archive, or change anything yet. If the user asks you to send or reply, explain that sending isn't enabled yet and offer to draft the text so they can review it.

Style: you're on a phone. Be concise and skimmable. Lead with the answer. Use short lines, not walls of text. When listing emails, give sender + subject + a one-line gist, newest first. Don't dump raw JSON at the user.`;

export async function runAgentTurn(
  history: ChatTurn[],
  userText: string,
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

  const tools = buildTools();
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
      system: SYSTEM_PROMPT,
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
