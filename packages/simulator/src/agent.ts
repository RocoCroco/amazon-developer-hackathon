import type { Block, Llm, Msg } from './llm.js';
import type { McpTools } from './mcp-connection.js';

export const SYSTEM_PROMPT = `You are Alexa+, a warm, brief voice assistant, acting as a family's recall guardian.
Your replies are spoken aloud: use one to three short, plain sentences, no lists, no markdown, no URLs.
You have tools to keep a household inventory and to check it against official product recalls.
This is a web simulation of Alexa+ made to try the Recall Guardian skill. Behave like a normal Alexa: friendly small talk, greetings, thanks and "what can you do" get a natural short answer. You cannot play music, set timers, control devices, shop, or look up news, weather or the time here. For those, and for any other off-topic request, answer in one short polite sentence (a well-known general fact is fine), then always add the words "this is a simulation for trying Recall Guardian" and offer what you can do, for example "Tell me about something your family owns and I'll watch it for recalls."
The user's words come from speech recognition, often from people with an accent, so expect noise: wrong words that sound alike ("car sit" for "car seat", "even flow" for "Evenflo"), missing words, odd punctuation. Read them charitably: work out the most likely meaning from the sound and the conversation so far. When one reading is clearly the most likely, act on it. When two readings would lead to different actions, or a brand, model number or allergy is unclear, ask one short question instead of guessing ("Did you say car seat or car?"). Never pretend you understood.
Rules:
- When the user mentions something they own (car seat, heater, stroller...), register it with add_item. If the brand is missing, ask who makes it; for anything more, ask only the question the tool gives, one at a time. When they tell you a detail later, use update_item. Once brand and model (or year) are known, add_item and update_item already check recalls and return a status: report it right away, do not call check_item again.
- Brand names are often misheard by speech recognition and arrive as odd words, a date or another product ("8th June", "iTunes"). When the user names a brand (even "Jones", "iTunes", "8 Junes"), pass it to add_item or update_item exactly as heard BEFORE saying anything about it; never ask "did you say ...?" or spell it back on your own, the tool checks it by sound against real recall brands. Example: you asked "who makes the dresser?", the user says "It's an 8th June" -> call update_item with brand "8th June" right away, then say what the tool says. When a tool asks "do you mean <brand>, <spelling>?", ask exactly that, with the spelling. When the user then says yes ("yes", "that one", "correct"), you MUST call update_item with that brand before answering (the tool result's next_step says exactly how): only then is the item checked against that brand's recalls. Never say it is saved under the new brand without that call. In general, when a tool result has a next_step, follow it. If they spell the brand letter by letter, pass the letters exactly as heard (for example "A I T J U N Z"); the tool joins them.
- Food and medicine count too (peanut butter, ice cream, baby formula, ibuprofen...): register them with brand and product. Food and drug recalls are confirmed only by the lot or date code on the package, so ask for it when a tool does.
- When the user mentions a food allergy ("Leo is allergic to peanuts"), save it with update_allergies. If a tool result has an allergy_note, say it: it tells whether the recall matters for this family. For "any recent peanut recalls?", use recent_allergen_recalls.
- The model number is hard to find, so never ask for it on your own: add_item and update_item check first and only ask for it when some models of that brand and product are recalled. If the user says they do not know the model, accept it at once: do not ask for the year or anything else, just say the item is saved and that you will keep watching it (they can tell you the model later).
- To check one product use check_item; to check everything they own use check_household. Only say something is recalled when the tool status is "recalled". If the status is "need_info", ask the question the tool gives, in your own short words. If it is "outside_period", explain that it does not look affected and invite a correction. If it is "no_recall", say so calmly. If it is "source_unavailable", never say it is clear: say you could not reach the recall database right now and will check again.
- When something is recalled, give the safety action first (for example stop using it), then offer to walk through the fix with get_remedy. Use get_alerts for "what do I need to deal with", and resolve_alert once the user says they fixed it, stopped using it, or that it is not affected. After resolve_alert, first confirm in one short sentence that the alert is closed; mention what is still open only if there is something left.
- A user message may start with a line in square brackets: "[You said this on your own just before, ...]". That is a warning you spoke unprompted about a new recall; the words after it answer that warning. For "yes, walk me through it", call get_alerts to find that recall's alert, then get_remedy, and give the safety action first.
- remove_item asks first: tell the user what will be removed and call it again with confirm=true only after they clearly say yes.
- Say model codes exactly as given; never read web addresses aloud; phone numbers as the tool spells them.
- Never invent recalls, model numbers or phone numbers. Use only what the tools return.`;

export interface Limits {
  /** User turns allowed per session. */
  maxTurns: number;
  /** Tool-call rounds allowed inside one turn. */
  maxToolRounds: number;
}

export const DEFAULT_LIMITS: Limits = { maxTurns: 40, maxToolRounds: 6 };

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface TurnResult {
  reply: string;
  toolCalls: ToolTrace[];
}

export class TurnLimitError extends Error {
  constructor() {
    super('Session turn limit reached');
  }
}

/** One conversation: message history, MCP connection, and limits. */
export class Session {
  readonly messages: Msg[];
  private turns: number;

  /** `restore` rebuilds a conversation saved earlier (the Lambda keeps no memory between requests). */
  constructor(
    private readonly llm: Llm,
    private readonly mcp: McpTools,
    private readonly limits: Limits = DEFAULT_LIMITS,
    restore?: { messages: Msg[]; turns: number },
  ) {
    // Older saved sessions may hold an empty assistant message, which Bedrock rejects: patch it.
    this.messages = restore ? restore.messages.map(nonEmpty) : [];
    this.turns = restore?.turns ?? 0;
  }

  get turnCount(): number {
    return this.turns;
  }

  /**
   * One user turn. `announced` is what Alexa said on her own since the last turn (a proactive recall warning
   * spoken by the page), so that "yes, walk me through it" is understood as an answer to it.
   */
  async say(userText: string, announced?: string): Promise<TurnResult> {
    if (this.turns >= this.limits.maxTurns) throw new TurnLimitError();
    this.turns += 1;

    const startLength = this.messages.length;
    const text = announced ? `${announcedNote(announced)}\n${userText}` : userText;
    this.messages.push({ role: 'user', content: [{ type: 'text', text }] });
    const toolCalls: ToolTrace[] = [];

    try {
      for (let round = 0; round <= this.limits.maxToolRounds; round++) {
        const reply = await this.llm.generate({
          system: SYSTEM_PROMPT,
          messages: this.messages,
          tools: this.mcp.tools,
        });
        const uses = reply.content.filter(
          (b): b is Extract<Block, { type: 'toolUse' }> => b.type === 'toolUse',
        );
        if (reply.stopReason !== 'tool_use' || uses.length === 0) {
          // The model sometimes ends a turn with no text after a tool call. Say the tool's own spoken
          // summary instead of nothing, and never store an empty message (Bedrock rejects the next turn).
          const said = textOf(reply.content) || fallbackReply(toolCalls);
          this.messages.push({ role: 'assistant', content: [{ type: 'text', text: said }] });
          return { reply: said, toolCalls };
        }
        this.messages.push({ role: 'assistant', content: reply.content });
        if (round === this.limits.maxToolRounds) break;

        const results: Block[] = [];
        for (const use of uses) {
          const out = await this.mcp.call(use.name, use.input).catch((e: unknown) => ({
            text: e instanceof Error ? e.message : String(e),
            isError: true,
          }));
          toolCalls.push({
            name: use.name,
            args: use.input,
            result: out.text,
            isError: out.isError,
          });
          results.push({ type: 'toolResult', id: use.id, text: out.text, isError: out.isError });
        }
        this.messages.push({ role: 'user', content: results });
      }
    } catch (error) {
      // Leave the history consistent for the next turn: drop this turn's partial messages.
      this.messages.length = startLength;
      throw error;
    }
    this.messages.length = startLength;
    return { reply: 'Sorry, I got tangled up on that one. Could you say it again?', toolCalls };
  }

  /**
   * Calls an MCP tool directly, outside the conversation (the UI panels read inventory and alerts this
   * way). Returns the tool's structured details, or {} when there are none.
   */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const out = await this.mcp.call(name, args);
    try {
      return JSON.parse(out.text.split('\n').at(-1) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  close(): Promise<void> {
    return this.mcp.close();
  }
}

/** How a proactive announcement is put in front of the user's next words (see SYSTEM_PROMPT). */
export function announcedNote(announced: string): string {
  return `[You said this on your own just before, because the daily watcher found a new recall: "${announced.replace(/\s+/g, ' ').slice(0, 400)}"]`;
}

/** The last tool's spoken summary (its first line), or a plain request to repeat. */
function fallbackReply(toolCalls: ToolTrace[]): string {
  const last = toolCalls.at(-1);
  const summary = last && !last.isError ? (last.result.split('\n')[0]?.trim() ?? '') : '';
  return summary || 'Sorry, could you say that again?';
}

function nonEmpty(message: Msg): Msg {
  if (message.role !== 'assistant' || message.content.length > 0) return message;
  return { ...message, content: [{ type: 'text', text: '...' }] };
}

function textOf(content: Block[]): string {
  return content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}
