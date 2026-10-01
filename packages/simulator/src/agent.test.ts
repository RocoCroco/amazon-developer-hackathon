import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNodeServer } from '../../mcp-server/src/node-server.js';
import { fromCpsc, type CpscRecall } from '../../mcp-server/src/recalls/cpsc.js';
import { StaticRecallProvider } from '../../mcp-server/src/recalls/provider.js';
import { InMemoryItemStore } from '../../mcp-server/src/store.js';
import { Session, TurnLimitError } from './agent.js';
import { ScriptedLlm, type Block, type LlmReply } from './llm.js';
import { connectMcp, type McpTools } from './mcp-connection.js';

const fixture = (name: string): CpscRecall[] =>
  JSON.parse(
    readFileSync(new URL(`../../mcp-server/test/fixtures/${name}`, import.meta.url), 'utf8'),
  );

const KEY = 'sim-test-key';
const HOUSEHOLD = 'sImSiMsImSiMsImSiMsImS1';
let url: string;
let stop: () => Promise<void>;

beforeAll(async () => {
  const recalls = fixture('cpsc-space-heater.json').map(fromCpsc);
  const s = await startNodeServer({
    store: new InMemoryItemStore(),
    recalls: new StaticRecallProvider(recalls),
    demoKey: KEY,
  });
  url = s.url;
  stop = s.close;
});

afterAll(() => stop());

const use = (id: string, name: string, input: Record<string, unknown>): LlmReply => ({
  content: [{ type: 'toolUse', id, name, input }],
  stopReason: 'tool_use',
});
const say = (text: string): LlmReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
});

describe('agent over a real MCP connection', () => {
  it('registers an item and checks it through MCP tools', async () => {
    const llm = new ScriptedLlm([
      use('t1', 'add_item', { name: 'space heater', brand: 'Govee', model: 'H7131' }),
      say('Got it, I saved your Govee space heater.'),
      use('t2', 'check_item', { name: 'space heater', brand: 'Govee', model: 'H7131' }),
      say(
        'Please stop using it. The heater can overheat. Want me to walk you through the free fix?',
      ),
    ]);
    const mcp = await connectMcp({ url, demoKey: KEY }, HOUSEHOLD);
    const session = new Session(llm, mcp);

    const first = await session.say('We got a Govee space heater, model H7131.');
    expect(first.reply).toMatch(/saved/);
    expect(first.toolCalls.map((t) => t.name)).toEqual(['add_item']);
    expect(first.toolCalls[0]?.result).toMatch(/saved your Govee/);

    const second = await session.say('Is it recalled?');
    expect(second.toolCalls[0]?.name).toBe('check_item');
    expect(second.toolCalls[0]?.result).toMatch(/"status":"recalled"/);
    expect(second.reply).toMatch(/stop using/);

    // The model saw the real tool list and the tool result in its next request.
    expect(llm.calls[0]?.tools.map((t) => t.name).sort()).toEqual([
      'add_item',
      'check_household',
      'check_item',
      'get_alerts',
      'get_remedy',
      'list_items',
      'remove_item',
      'resolve_alert',
      'update_item',
    ]);
    const lastCall = llm.calls[3]!;
    const resultBlock = lastCall.messages.at(-1)!.content[0] as Extract<
      Block,
      { type: 'toolResult' }
    >;
    expect(resultBlock.type).toBe('toolResult');
    expect(resultBlock.text).toMatch(/is recalled/);
    await session.close();
  });

  it('rejects a wrong demo key', async () => {
    await expect(connectMcp({ url, demoKey: 'wrong' }, HOUSEHOLD)).rejects.toThrow();
  });
});

describe('agent limits and failure handling', () => {
  const fakeMcp = (call: McpTools['call']): McpTools => ({
    tools: [],
    call,
    close: async () => {},
  });

  it('enforces the per-session turn limit', async () => {
    const llm = new ScriptedLlm([say('one'), say('two'), say('three')]);
    const session = new Session(
      llm,
      fakeMcp(async () => ({ text: '', isError: false })),
      {
        maxTurns: 2,
        maxToolRounds: 3,
      },
    );
    await session.say('a');
    await session.say('b');
    await expect(session.say('c')).rejects.toBeInstanceOf(TurnLimitError);
    expect(llm.calls).toHaveLength(2);
  });

  it('stops a runaway tool loop and keeps the history clean', async () => {
    const loop = Array.from({ length: 10 }, (_, i) => use(`t${i}`, 'check_item', { name: 'x' }));
    const llm = new ScriptedLlm([...loop, say('fine now')]);
    let calls = 0;
    const session = new Session(
      llm,
      fakeMcp(async () => (calls++, { text: 'ok', isError: false })),
      {
        maxTurns: 5,
        maxToolRounds: 2,
      },
    );
    const res = await session.say('go');
    expect(calls).toBe(2);
    expect(res.reply).toMatch(/tangled/);
    expect(session.messages).toHaveLength(0);
  });

  it('reports tool errors back to the model instead of crashing', async () => {
    const llm = new ScriptedLlm([
      use('t1', 'check_item', {}),
      say('Sorry, I could not check that.'),
    ]);
    const session = new Session(
      llm,
      fakeMcp(async () => {
        throw new Error('network down');
      }),
    );
    const res = await session.say('check');
    expect(res.toolCalls[0]).toMatchObject({ isError: true, result: 'network down' });
    expect(res.reply).toMatch(/could not check/);
    const sent = llm.calls[1]!.messages.at(-1)!.content[0] as Extract<
      Block,
      { type: 'toolResult' }
    >;
    expect(sent.isError).toBe(true);
  });

  it('drops the partial turn when the model call fails', async () => {
    const llm = new ScriptedLlm([]); // no replies -> generate throws
    const session = new Session(
      llm,
      fakeMcp(async () => ({ text: '', isError: false })),
    );
    await expect(session.say('hi')).rejects.toThrow(/out of replies/);
    expect(session.messages).toHaveLength(0);
  });
});
