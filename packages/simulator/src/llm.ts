import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';

/** Provider-neutral conversation types, so the agent can be tested without Bedrock. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'toolUse'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'toolResult'; id: string; text: string; isError?: boolean };

export interface Msg {
  role: 'user' | 'assistant';
  content: Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmReply {
  content: Block[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
}

export interface Llm {
  generate(args: { system: string; messages: Msg[]; tools: ToolDef[] }): Promise<LlmReply>;
}

/** Cheapest suitable model (see BLOCKERS B1). Override with BEDROCK_MODEL_ID. */
export const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

function toBedrock(block: Block): ContentBlock {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'toolUse':
      return { toolUse: { toolUseId: block.id, name: block.name, input: block.input as never } };
    case 'toolResult':
      return {
        toolResult: {
          toolUseId: block.id,
          content: [{ text: block.text }],
          status: block.isError ? 'error' : 'success',
        },
      };
  }
}

function fromBedrock(block: ContentBlock): Block | undefined {
  if (block.text !== undefined) return { type: 'text', text: block.text };
  if (block.toolUse) {
    return {
      type: 'toolUse',
      id: block.toolUse.toolUseId ?? '',
      name: block.toolUse.name ?? '',
      input: (block.toolUse.input ?? {}) as Record<string, unknown>,
    };
  }
  return undefined;
}

export class BedrockLlm implements Llm {
  constructor(
    private readonly modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID,
    private readonly client = new BedrockRuntimeClient({ region: 'us-east-1' }),
    private readonly maxTokens = 600,
  ) {}

  async generate({ system, messages, tools }: Parameters<Llm['generate']>[0]): Promise<LlmReply> {
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: system }],
        messages: messages.map((m): Message => ({
          role: m.role,
          content: m.content.map(toBedrock),
        })),
        toolConfig: tools.length
          ? {
              tools: tools.map((t) => ({
                toolSpec: {
                  name: t.name,
                  description: t.description,
                  inputSchema: { json: t.inputSchema as never },
                },
              })),
            }
          : undefined,
        inferenceConfig: { maxTokens: this.maxTokens, temperature: 0.3 },
      }),
    );
    const content = (res.output?.message?.content ?? [])
      .map(fromBedrock)
      .filter((b): b is Block => b !== undefined);
    const stop = res.stopReason;
    return {
      content,
      stopReason:
        stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' ? stop : 'other',
    };
  }
}

/** Plays back pre-written replies; records what it was asked. For tests. */
export class ScriptedLlm implements Llm {
  readonly calls: { system: string; messages: Msg[]; tools: ToolDef[] }[] = [];
  private index = 0;

  constructor(private readonly replies: LlmReply[]) {}

  async generate(args: Parameters<Llm['generate']>[0]): Promise<LlmReply> {
    this.calls.push(structuredClone(args));
    const reply = this.replies[this.index++];
    if (!reply) throw new Error('ScriptedLlm ran out of replies');
    return reply;
  }
}
