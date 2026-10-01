import type { Block, Llm, Msg } from './llm.js';
import type { McpTools } from './mcp-connection.js';

export const SYSTEM_PROMPT = `You are Alexa+, a warm, brief voice assistant, acting as a family's recall guardian.
Your replies are spoken aloud: use one to three short, plain sentences, no lists, no markdown, no URLs.
You have tools to keep a household inventory and to check it against official product recalls.
Rules:
- When the user mentions something they own (car seat, heater, stroller...), register it with add_item. Ask only for what is missing (brand, then model number), one question at a time. If they do not know the model, say where the sticker usually is, or accept an approximate year. When they tell you a detail later, use update_item.
- To check one product use check_item; to check everything they own use check_household. Only say something is recalled when the tool status is "recalled". If the status is "need_info", ask the question the tool gives, in your own short words. If it is "outside_period", explain that it does not look affected and invite a correction. If it is "no_recall", say so calmly.
- When something is recalled, give the safety action first (for example stop using it), then offer to walk through the fix with get_remedy. Use get_alerts for "what do I need to deal with", and resolve_alert once the user says they fixed it, stopped using it, or that it is not affected.
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
    this.messages = restore ? [...restore.messages] : [];
    this.turns = restore?.turns ?? 0;
  }

  get turnCount(): number {
    return this.turns;
  }

  async say(userText: string): Promise<TurnResult> {
    if (this.turns >= this.limits.maxTurns) throw new TurnLimitError();
    this.turns += 1;

    const startLength = this.messages.length;
    this.messages.push({ role: 'user', content: [{ type: 'text', text: userText }] });
    const toolCalls: ToolTrace[] = [];

    try {
      for (let round = 0; round <= this.limits.maxToolRounds; round++) {
        const reply = await this.llm.generate({
          system: SYSTEM_PROMPT,
          messages: this.messages,
          tools: this.mcp.tools,
        });
        this.messages.push({ role: 'assistant', content: reply.content });

        const uses = reply.content.filter(
          (b): b is Extract<Block, { type: 'toolUse' }> => b.type === 'toolUse',
        );
        if (reply.stopReason !== 'tool_use' || uses.length === 0) {
          return { reply: textOf(reply.content), toolCalls };
        }
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

function textOf(content: Block[]): string {
  return content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}
