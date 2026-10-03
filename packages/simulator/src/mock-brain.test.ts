import { describe, expect, it } from 'vitest';
import type { Block, LlmReply, Msg } from './llm.js';
import { RuleBasedLlm } from './mock-brain.js';

type ToolUse = Extract<Block, { type: 'toolUse' }>;

const user = (text: string): Msg => ({ role: 'user', content: [{ type: 'text', text }] });
const assistant = (text: string): Msg => ({ role: 'assistant', content: [{ type: 'text', text }] });
const ask = (messages: Msg[]) => new RuleBasedLlm().generate({ system: '', messages, tools: [] });
const toolUses = (r: LlmReply) => r.content.filter((b): b is ToolUse => b.type === 'toolUse');
const spoken = (r: LlmReply) => (r.content[0] as { text: string }).text;

/** A tool call and its result as they appear in a conversation (summary, then the JSON details). */
function exchange(
  id: string,
  name: string,
  input: Record<string, unknown>,
  summary: string,
  data: Record<string, unknown> = {},
): Msg[] {
  return [
    { role: 'assistant', content: [{ type: 'toolUse', id, name, input }] },
    {
      role: 'user',
      content: [
        { type: 'toolResult', id, text: `${summary}\n${JSON.stringify({ summary, ...data })}` },
      ],
    },
  ];
}

const seatAdded = exchange(
  't1',
  'add_item',
  { name: 'car seat' },
  'Okay, I saved your car seat. Who makes it?',
  { item_id: 'seat1' },
);
const heaterAdded = exchange(
  't2',
  'add_item',
  { name: 'space heater', brand: 'Govee' },
  'Okay, I saved your Govee space heater.',
  { item_id: 'heater1' },
);

describe('registering', () => {
  it('registers one item with brand, product and model', async () => {
    const [use] = toolUses(
      await ask([user('We got a second-hand Govee space heater, model number H7131.')]),
    );
    expect(use).toMatchObject({
      name: 'add_item',
      input: { name: 'space heater', brand: 'Govee', model: 'H7131' },
    });
  });

  it('registers two products from one sentence, in parallel', async () => {
    const uses = toolUses(
      await ask([user('We got a hand-me-down Graco car seat and a second-hand space heater.')]),
    );
    expect(uses.map((u) => [u.name, u.input.name, u.input.brand])).toEqual([
      ['add_item', 'car seat', 'Graco'],
      ['add_item', 'space heater', undefined],
    ]);
  });

  it('registers without a brand when the user gives none', async () => {
    const [use] = toolUses(await ask([user('We got a hand-me-down car seat from my cousin.')]));
    expect(use?.input).toEqual({ name: 'car seat' });
  });

  it('does not register the same thing twice', async () => {
    const r = await ask([
      user('We got a car seat.'),
      ...seatAdded,
      assistant('Who makes it?'),
      user('We got a car seat.'),
    ]);
    expect(toolUses(r).map((u) => u.name)).not.toContain('add_item');
  });
});

describe('what it says after tool results', () => {
  it('speaks the first line of a tool result', async () => {
    const r = await ask([
      user('hi'),
      {
        role: 'user',
        content: [
          { type: 'toolResult', id: 'x', text: 'Good news: nothing.\n{"status":"no_recall"}' },
        ],
      },
    ]);
    expect(r.stopReason).toBe('end_turn');
    expect(spoken(r)).toBe('Good news: nothing.');
  });

  it('turns two registrations into one friendly sentence and one question', async () => {
    const uses = new Map<string, Msg>();
    void uses;
    const messages: Msg[] = [
      user('We got a car seat and a heater.'),
      {
        role: 'assistant',
        content: [
          { type: 'toolUse', id: 'a', name: 'add_item', input: { name: 'car seat' } },
          { type: 'toolUse', id: 'b', name: 'add_item', input: { name: 'space heater' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'toolResult',
            id: 'a',
            text: 'Okay, I saved your car seat. Who makes it?\n{"item_id":"s"}',
          },
          {
            type: 'toolResult',
            id: 'b',
            text: 'Okay, I saved your space heater. Who makes it?\n{"item_id":"h"}',
          },
        ],
      },
    ];
    expect(spoken(await ask(messages))).toBe(
      'Okay, I saved your car seat and your space heater. Who makes the car seat?',
    );
  });
});

describe('telling it more', () => {
  it('updates the item the user names', async () => {
    const history = [user('We got a car seat and a heater.'), ...seatAdded, ...heaterAdded];
    const [use] = toolUses(
      await ask([
        ...history,
        assistant('Who makes the car seat?'),
        user('The car seat is a Graco.'),
      ]),
    );
    expect(use).toMatchObject({ name: 'update_item', input: { item_id: 'seat1', brand: 'Graco' } });
  });

  it('updates the latest incomplete item when none is named', async () => {
    const [use] = toolUses(
      await ask([
        user('A car seat.'),
        ...seatAdded,
        assistant('Who makes it?'),
        user('The model is B-Agile 360.'),
      ]),
    );
    expect(use).toMatchObject({
      name: 'update_item',
      input: { item_id: 'seat1', model: 'B-Agile 360' },
    });
  });

  it('checks the item right after a brand is learned, instead of only saying "updated"', async () => {
    const messages = [
      user('A car seat.'),
      ...seatAdded,
      assistant('Who makes it?'),
      user("It's a Graco."),
      ...exchange(
        't3',
        'update_item',
        { item_id: 'seat1', brand: 'Graco' },
        'Okay, I updated your Graco car seat.',
        { status: 'updated', item_id: 'seat1', name: 'car seat', brand: 'Graco' },
      ),
    ];
    const [use] = toolUses(await ask(messages));
    expect(use).toMatchObject({ name: 'check_item', input: { item_id: 'seat1' } });
  });
});

describe('checking', () => {
  it('checks everything', async () => {
    for (const phrase of [
      'Is anything we own recalled?',
      'Check everything please.',
      'Is everything we have safe? Any recall?',
    ]) {
      expect(toolUses(await ask([user(phrase)])).map((u) => u.name)).toEqual(['check_household']);
    }
  });

  it('checks "it" as the last item talked about, and a named item by id', async () => {
    const history = [user('A Govee heater.'), ...heaterAdded];
    expect(
      toolUses(await ask([...history, assistant('Saved.'), user('Is it recalled?')]))[0],
    ).toMatchObject({
      name: 'check_item',
      input: { item_id: 'heater1' },
    });
    expect(
      toolUses(await ask([...history, assistant('Saved.'), user('Is my space heater safe?')]))[0],
    ).toMatchObject({
      name: 'check_item',
      input: { item_id: 'heater1' },
    });
  });

  it('lists what is registered', async () => {
    expect(toolUses(await ask([user('What do we have registered?')]))[0]?.name).toBe('list_items');
  });
});

describe('alerts, the fix, and closing', () => {
  const alerts = exchange('g1', 'get_alerts', {}, 'You have one recall alert.', {
    alerts: [
      { alert_id: 'q1', item: 'Graco car seat', kind: 'need_info' },
      { alert_id: 'r1', item: 'Govee space heater', kind: 'recalled' },
    ],
  });

  it('lists alerts', async () => {
    expect(toolUses(await ask([user('Do I have any alerts?')]))[0]?.name).toBe('get_alerts');
  });

  it('walks through the fix of the confirmed recall, not the open question', async () => {
    const [use] = toolUses(
      await ask([
        user('Alerts?'),
        ...alerts,
        assistant('One alert.'),
        user('Walk me through the fix.'),
      ]),
    );
    expect(use).toMatchObject({ name: 'get_remedy', input: { alert_id: 'r1' } });
  });

  it('fetches the alerts first when it does not know them yet', async () => {
    expect(toolUses(await ask([user('Walk me through the fix.')]))[0]?.name).toBe('get_alerts');
  });

  it('closes the alert it just explained', async () => {
    const history = [
      user('Alerts?'),
      ...alerts,
      ...exchange('g2', 'get_remedy', { alert_id: 'r1' }, 'Stop using it.', { status: 'remedy' }),
    ];
    const resolve = async (phrase: string) =>
      toolUses(await ask([...history, assistant('Stop using it.'), user(phrase)]))[0];
    expect(await resolve('I got the replacement, it is fixed.')).toMatchObject({
      name: 'resolve_alert',
      input: { alert_id: 'r1', resolution: 'fixed' },
    });
    expect(await resolve('I stopped using it.')).toMatchObject({
      input: { resolution: 'stopped_using' },
    });
    expect(await resolve('Turns out it is not affected.')).toMatchObject({
      input: { resolution: 'not_affected' },
    });
  });
});

describe('removing asks first', () => {
  const history = [user('A Govee heater.'), ...heaterAdded];
  const asked = [
    ...history,
    assistant('Saved.'),
    user('Remove the space heater.'),
    ...exchange(
      't9',
      'remove_item',
      { item_id: 'heater1' },
      'Do you want me to remove your Govee space heater? Say yes to confirm.',
      { status: 'needs_confirmation' },
    ),
    assistant('Do you want me to remove your Govee space heater?'),
  ];

  it('first asks (no confirm), then confirms only after a yes', async () => {
    const [first] = toolUses(
      await ask([...history, assistant('Saved.'), user('Remove the space heater.')]),
    );
    expect(first).toMatchObject({ name: 'remove_item', input: { item_id: 'heater1' } });
    expect(first?.input).not.toHaveProperty('confirm');

    const [confirmed] = toolUses(await ask([...asked, user('Yes please.')]));
    expect(confirmed).toMatchObject({
      name: 'remove_item',
      input: { item_id: 'heater1', confirm: true },
    });
  });

  it('keeps the item after a no', async () => {
    const r = await ask([...asked, user('No, keep it.')]);
    expect(toolUses(r)).toEqual([]);
    expect(spoken(r)).toMatch(/keep it/);
  });
});

describe('everything else', () => {
  it('falls back to a helpful prompt', async () => {
    const r = await ask([user('how are things going')]);
    expect(toolUses(r)).toEqual([]);
    expect(spoken(r)).toMatch(/What did you get/);
  });
});

describe('off topic (a normal Alexa, but limited)', () => {
  it.each([
    "What's the weather tomorrow?",
    'Play some jazz',
    'Set a timer for ten minutes',
    'Tell me a joke',
  ])('"%s": a polite no and a reminder that this is a Recall Guardian simulation', async (said) => {
    const r = await ask([user(said)]);
    expect(toolUses(r)).toHaveLength(0);
    expect(spoken(r)).toMatch(/simulation of Alexa for trying Recall Guardian/);
  });

  it('answers a greeting like a normal Alexa', async () => {
    const r = await ask([user('Hello Alexa')]);
    expect(spoken(r)).toMatch(/^Hi!/);
  });
});
