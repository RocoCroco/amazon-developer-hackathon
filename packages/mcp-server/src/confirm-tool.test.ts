import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedConfirmer, type Confirmer, type Verdict } from './matcher/confirm.js';
import { startNodeServer } from './node-server.js';
import { fromCpsc, type CpscRecall } from './recalls/cpsc.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';

const heaters = (
  JSON.parse(
    readFileSync(new URL('../test/fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
  ) as CpscRecall[]
).map(fromCpsc);

const HOUSEHOLD = 'cOnFiRmCoNfIrMcOnFiRm1';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function setup(confirmer?: Confirmer) {
  const s = await startNodeServer({
    store: new InMemoryItemStore(),
    recalls: new StaticRecallProvider(heaters),
    confirmer,
  });
  const client = new Client({ name: 'confirm-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(s.url), {
      requestInit: { headers: { 'x-household-id': HOUSEHOLD } },
    }),
  );
  closers.push(async () => {
    await client.close();
    await s.close();
  });
  return async (args: Record<string, unknown>) => {
    const res = await client.callTool({ name: 'check_item', arguments: args });
    const text = (res.content as { text: string }[])[0]!.text;
    return { summary: text, data: res.structuredContent as Record<string, unknown> };
  };
}

const govee = { name: 'space heater', brand: 'Govee', model: 'H7131' };
const verdictFor = (v: Partial<Verdict>): Record<string, Verdict> => ({
  'cpsc:10086': { match: 'unsure', confidence: 0.5, reason: 'r', ...v },
});

describe('check_item with a second opinion', () => {
  it('still reports a recall the model confirms, and shows its reason', async () => {
    const check = await setup(
      new ScriptedConfirmer(
        verdictFor({ match: 'yes', confidence: 0.95, reason: 'Model H7131 is listed.' }),
      ),
    );
    const { summary, data } = await check(govee);
    expect(data.status).toBe('recalled');
    expect(summary).toMatch(/is recalled/);
    expect((data.matches as { second_opinion: string }[])[0]?.second_opinion).toBe(
      'Model H7131 is listed.',
    );
  });

  it('does not claim a recall the model doubts: it asks the model question instead', async () => {
    const check = await setup(
      new ScriptedConfirmer(
        verdictFor({ match: 'unsure', clarifying_question: 'What size is the heater?' }),
      ),
    );
    const { summary, data } = await check(govee);
    expect(data.status).toBe('need_info');
    expect(summary).not.toMatch(/is recalled/);
    expect(summary).toContain('What size is the heater?');
  });

  it('drops an open match that the model is sure does not apply', async () => {
    const check = await setup(new ScriptedConfirmer(verdictFor({ match: 'no', confidence: 0.97 })));
    const { summary, data } = await check({ name: 'space heater', brand: 'Govee' });
    expect(data.status).toBe('no_recall');
    expect(summary).toMatch(/no recalls/);
  });

  it('works unchanged when the model call fails (the automatic result stands)', async () => {
    const check = await setup({
      confirm: async () => {
        throw new Error('Model use case details have not been submitted');
      },
    });
    const { data } = await check(govee);
    expect(data.status).toBe('recalled');
  });

  it('works without any confirmer', async () => {
    const check = await setup();
    expect((await check(govee)).data.status).toBe('recalled');
  });
});
