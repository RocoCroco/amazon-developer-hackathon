import { describe, expect, it } from 'vitest';
import type { Block, Msg } from './llm.js';
import { RuleBasedLlm } from './mock-brain.js';

const user = (text: string): Msg => ({ role: 'user', content: [{ type: 'text', text }] });
const ask = (messages: Msg[]) => new RuleBasedLlm().generate({ system: '', messages, tools: [] });
const toolUse = (r: Awaited<ReturnType<typeof ask>>) =>
  r.content.find((b): b is Extract<Block, { type: 'toolUse' }> => b.type === 'toolUse');

describe('rule-based demo brain', () => {
  it('registers an item with brand, product and model', async () => {
    const r = await ask([user('We got a second-hand Govee space heater, model number H7131.')]);
    expect(toolUse(r)).toMatchObject({
      name: 'add_item',
      input: { name: 'space heater', brand: 'Govee', model: 'H7131' },
    });
  });

  it('registers without a brand when the user gives none', async () => {
    const r = await ask([user('We got a hand-me-down car seat from my cousin.')]);
    expect(toolUse(r)).toMatchObject({ name: 'add_item', input: { name: 'car seat' } });
    expect(toolUse(r)?.input).not.toHaveProperty('brand');
  });

  it('checks the last known item when asked about recalls', async () => {
    const earlier: Msg[] = [
      user('We got a Graco car seat.'),
      {
        role: 'assistant',
        content: [
          {
            type: 'toolUse',
            id: '1',
            name: 'add_item',
            input: { name: 'car seat', brand: 'Graco' },
          },
        ],
      },
      { role: 'user', content: [{ type: 'toolResult', id: '1', text: 'saved' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'saved' }] },
      user('Is anything we own recalled?'),
    ];
    expect(toolUse(await ask(earlier))).toMatchObject({
      name: 'check_item',
      input: { name: 'car seat', brand: 'Graco' },
    });
  });

  it('speaks the first line of a tool result', async () => {
    const r = await ask([
      user('hi'),
      {
        role: 'user',
        content: [
          { type: 'toolResult', id: '1', text: 'Good news: nothing.\n{"status":"no_recall"}' },
        ],
      },
    ]);
    expect(r.stopReason).toBe('end_turn');
    expect(r.content[0]).toEqual({ type: 'text', text: 'Good news: nothing.' });
  });

  it('falls back to a helpful prompt', async () => {
    const r = await ask([user('what is the weather')]);
    expect(r.content[0]).toMatchObject({ type: 'text' });
    expect(toolUse(r)).toBeUndefined();
  });
});
