import type { Block, Llm, Msg } from './llm.js';
import type { McpTools } from './mcp-connection.js';

export const SYSTEM_PROMPT = `You are Alexa+, a warm, brief voice assistant, acting as a family's recall guardian.
Your replies are spoken aloud: use one to three short, plain sentences, no lists, no markdown, no URLs.
You have tools to register things the household owns, and to check them for official product recalls.
Rules:
- When the user mentions something they own (car seat, heater, stroller...), register it with add_item. Ask only for what is missing (brand, then model number), one question at a time. If they do not know the model, say where the sticker usually is, or accept an approximate year.
- To check recalls use check_item. Only say an item is recalled when the tool status is "recalled". If the status is "need_info", ask the question in the tool summary. If it is "no_recall", say so calmly.
- When something is recalled, give the safety action first (for example stop using it), then offer to walk through the free fix.
- Read model codes character by character; never read web addresses aloud.
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
  readonly messages: Msg[] = [];
  private turns = 0;

  constructor(
    private readonly llm: Llm,
    private readonly mcp: McpTools,
    private readonly limits: Limits = DEFAULT_LIMITS,
  ) {}

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
