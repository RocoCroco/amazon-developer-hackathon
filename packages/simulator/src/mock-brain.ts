import type { Block, Llm, LlmReply, Msg } from './llm.js';

/**
 * A deterministic stand-in for the Claude "Alexa+ brain": regex intents that emit REAL MCP tool calls, with
 * its memory (items, alerts, a pending removal) rebuilt from the tool results in the conversation. Used
 * when Bedrock is unavailable (tests, offline demo fallback). It is not smart; the real brain is BedrockLlm.
 */
const PRODUCTS = [
  'car seat',
  'booster seat',
  'space heater',
  'heater',
  'stroller',
  'crib',
  'bassinet',
  'high chair',
  'dresser',
  'playpen',
  'baby monitor',
  'air fryer',
  'pressure cooker',
  'bike helmet',
  'power bank',
  'mattress',
  'tire',
];

interface Facts {
  name?: string;
  brand?: string;
  model?: string;
  year?: number;
  month?: number;
}

interface KnownItem extends Facts {
  id: string;
  name: string;
}

interface KnownAlert {
  id: string;
  item: string;
  kind: string;
}

interface State {
  items: KnownItem[];
  alerts: KnownAlert[];
  lastAlertId?: string;
  pendingRemove?: KnownItem;
}

type ToolUse = Extract<Block, { type: 'toolUse' }>;
type ToolResult = Extract<Block, { type: 'toolResult' }>;

const NOT_BRANDS = /^(We|I|My|Our|The|It|Is|Yes|No|A|An|Do|Does|Any|Please|Okay|Also)$/;
const BRAND_PHRASE = /\b(?:it'?s|made by|brand is|by|a|an)\s+([A-Z][A-Za-z0-9-]+)\b/;
const MODEL =
  /\bmodel(?:\s+(?:number|no\.?|name))?(?:\s+is)?\s+([A-Za-z0-9][A-Za-z0-9-]*(?:\s+\d+)?)/i;
const BARE_MODEL = /\b(?:it'?s|is)\s+([A-Z]{1,4}-?\d[A-Za-z0-9-]*)\b/;
const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/;

/** Facts in one phrase: brand (a capital word before the product, or "it's a Graco"), model, year. */
function parseFacts(text: string): Facts {
  const lower = text.toLowerCase();
  const facts: Facts = {};
  const name = PRODUCTS.find((p) => lower.includes(p));
  if (name) {
    facts.name = name;
    const before = text.slice(0, lower.indexOf(name));
    const brand = /([A-Z][A-Za-z0-9-]+)\s+(?:[a-z-]+\s+)?$/.exec(before);
    if (brand?.[1] && !NOT_BRANDS.test(brand[1])) facts.brand = brand[1];
  }
  if (!facts.brand) {
    const brand =
      BRAND_PHRASE.exec(text) ??
      /^\s*(?:the\s+\w+(?:\s+\w+)?\s+is\s+)?(?:a|an)?\s*([A-Z][A-Za-z0-9-]+)\s*[.!]?\s*$/.exec(
        text,
      );
    if (brand?.[1] && !NOT_BRANDS.test(brand[1])) facts.brand = brand[1];
  }
  const model = MODEL.exec(text) ?? BARE_MODEL.exec(text);
  if (model?.[1]) facts.model = model[1];
  const year = YEAR.exec(text);
  if (year?.[1]) facts.year = Number(year[1]);
  return facts;
}

const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Tool arguments from facts: only what is set. */
const args = (o: object): Record<string, unknown> => ({ ...compact(o) });

/** Structured details of a tool result: the last line of its text is the JSON. */
function detailsOf(result: ToolResult): Record<string, unknown> {
  try {
    return JSON.parse(result.text.split('\n').at(-1) ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Rebuilds what the assistant knows from the tool calls and results so far. */
function readState(messages: Msg[]): State {
  const uses = new Map<string, ToolUse>();
  const state: State = { items: [], alerts: [] };

  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'toolUse') uses.set(b.id, b);
      if (b.type !== 'toolResult') continue;
      const use = uses.get(b.id);
      const data = detailsOf(b);
      if (!use) continue;
      const input = use.input as Facts & { item_id?: string; alert_id?: string };

      if (use.name === 'add_item' && typeof data.item_id === 'string') {
        state.items.push({ ...compact(input), id: data.item_id, name: input.name ?? 'item' });
      } else if (use.name === 'update_item' && data.status === 'updated') {
        const known = state.items.find((i) => i.id === data.item_id);
        if (known)
          Object.assign(
            known,
            compact({
              name: data.name,
              brand: data.brand,
              model: data.model,
              year: data.year,
            } as Facts),
          );
      } else if (use.name === 'list_items' && Array.isArray(data.items)) {
        state.items = (data.items as Record<string, unknown>[]).map((i) => ({
          id: String(i.item_id),
          name: String(i.name),
          brand: i.brand as string | undefined,
          model: i.model as string | undefined,
        }));
      } else if (use.name === 'remove_item') {
        const target = state.items.find((i) => i.id === input.item_id);
        if (data.status === 'needs_confirmation' && target) state.pendingRemove = target;
        if (data.status === 'removed') {
          state.items = state.items.filter((i) => i.id !== input.item_id);
          state.pendingRemove = undefined;
        }
      } else if (use.name === 'get_alerts' || use.name === 'check_household') {
        const listed = [
          ...((data.alerts ?? []) as Record<string, string>[]),
          ...((data.recalled ?? []) as Record<string, string>[]),
          ...((data.need_info ?? []) as Record<string, string>[]),
        ];
        if (listed.length) {
          state.alerts = listed.map((a) => ({ id: a.alert_id!, item: a.item!, kind: a.kind! }));
        }
      } else if (use.name === 'get_remedy' || use.name === 'resolve_alert') {
        state.lastAlertId = input.alert_id;
        if (use.name === 'resolve_alert' && data.status === 'resolved') {
          state.alerts = state.alerts.filter((a) => a.id !== input.alert_id);
        }
      }
    }
  }
  return state;
}

const text = (t: string): LlmReply => ({
  content: [{ type: 'text', text: t }],
  stopReason: 'end_turn',
});
let counter = 0;
const call = (...uses: [string, Record<string, unknown>][]): LlmReply => ({
  content: uses.map(([name, input]) => ({
    type: 'toolUse' as const,
    id: `mock-${++counter}-${name}`,
    name,
    input,
  })),
  stopReason: 'tool_use',
});

const mentions = (t: string, item: KnownItem) => t.toLowerCase().includes(item.name.toLowerCase());
const incomplete = (i: KnownItem) => !i.brand || !i.model;

/** What to say after tool results: the tools' own spoken summaries, composed so it stays short. */
function speakResults(results: ToolResult[], uses: Map<string, ToolUse>): string {
  const lines = results.map((r) => r.text.split('\n')[0]?.trim() ?? '');
  const adds = results.filter((r) => uses.get(r.id)?.name === 'add_item');
  if (adds.length > 1 && adds.length === results.length) {
    // "Okay, I saved your car seat. Who makes it?" x2 -> one friendly sentence and ONE question.
    const names = adds.map((r) => uses.get(r.id)!.input.name as string);
    const first = lines[0] ?? '';
    const question = first.split('. ').slice(1).join('. ');
    return `Okay, I saved your ${names.slice(0, -1).join(', ')} and your ${names.at(-1)}. ${question.replace(/Who makes it\?/, `Who makes the ${names[0]}?`)}`.trim();
  }
  return lines.filter(Boolean).slice(0, 2).join(' ');
}

export class RuleBasedLlm implements Llm {
  async generate({ messages }: Parameters<Llm['generate']>[0]): Promise<LlmReply> {
    const last = messages.at(-1);
    const results = last?.content.filter((b): b is ToolResult => b.type === 'toolResult');
    if (results?.length) {
      const uses = new Map<string, ToolUse>();
      for (const m of messages)
        for (const b of m.content) if (b.type === 'toolUse') uses.set(b.id, b);
      // Once the owner supplies a missing detail, check the item right away instead of just saying "updated".
      const only = results.length === 1 ? results[0] : undefined;
      if (only && uses.get(only.id)?.name === 'update_item') {
        const data = detailsOf(only);
        if (data.status === 'updated' && data.brand)
          return call(['check_item', { item_id: data.item_id }]);
      }
      return text(speakResults(results, uses));
    }

    const said =
      last?.content.find((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')?.text ??
      '';
    const lower = said.toLowerCase();
    const state = readState(messages.slice(0, -1));
    const firstRecalled = state.alerts.find((a) => a.kind === 'recalled') ?? state.alerts[0];

    // 1. Answer to "Do you want me to remove ...?"
    if (state.pendingRemove) {
      if (/^\s*(yes|yeah|yep|sure|please|confirm|do it|go ahead)/i.test(said)) {
        return call(['remove_item', { item_id: state.pendingRemove.id, confirm: true }]);
      }
      if (/^\s*(no|nope|don'?t|cancel|never ?mind)/i.test(said)) return text("Okay, I'll keep it.");
    }

    // 2. Closing an alert
    if (
      /\b(fixed|replaced|got (the|a|my) (refund|replacement|repair)|stopped using|threw (it )?away|thrown away|not affected|dismiss)\b/.test(
        lower,
      )
    ) {
      const alertId = state.lastAlertId ?? firstRecalled?.id;
      if (alertId) {
        const resolution = /not affected/.test(lower)
          ? 'not_affected'
          : /dismiss/.test(lower)
            ? 'dismissed'
            : /stopped using|threw|thrown/.test(lower)
              ? 'stopped_using'
              : 'fixed';
        return call(['resolve_alert', { alert_id: alertId, resolution }]);
      }
    }

    // 3. The fix
    if (
      /\b(walk me through|fix it|how do i (fix|get)|what (do|should) i do|the fix|remedy)\b/.test(
        lower,
      )
    ) {
      if (firstRecalled) return call(['get_remedy', { alert_id: firstRecalled.id }]);
      return call(['get_alerts', {}]);
    }

    // 4. Alerts
    if (/\b(alerts?|urgent|need to deal with|anything new|warnings?|what'?s wrong)\b/.test(lower)) {
      return call(['get_alerts', {}]);
    }

    // 5. Check everything
    if (
      /\b(anything|everything|all)\b.*\b(recall|recalled|unsafe)\b|\bcheck (everything|all|the house|what we own)\b/.test(
        lower,
      )
    ) {
      return call(['check_household', {}]);
    }

    // 6. List
    if (
      /\bwhat (do|have) (i|we) (have|own|registered)\b|\bwhat'?s (on )?my list\b|\blist (my|our) (things|items)\b/.test(
        lower,
      )
    ) {
      return call(['list_items', {}]);
    }

    // 7. Remove
    if (/\b(remove|delete|forget about)\b/.test(lower)) {
      const target = state.items.find((i) => mentions(said, i));
      if (target) return call(['remove_item', { item_id: target.id }]);
    }

    // 8. Check one registered item
    if (/\b(recalled|safe)\b|\bcheck (my|our|the)\b/.test(lower)) {
      const target = state.items.find((i) => mentions(said, i));
      if (target) return call(['check_item', { item_id: target.id }]);
      const parsed = parseFacts(said);
      if (parsed.name) return call(['check_item', args(parsed)]);
      // "Is it recalled?" refers to the thing we just talked about.
      const latest = state.items.at(-1);
      if (latest && /\b(it|this|that)\b/.test(lower))
        return call(['check_item', { item_id: latest.id }]);
      if (state.items.length) return call(['check_household', {}]);
    }

    // 9. Registering products (one or several in one sentence)
    // Several products are joined by "and"; with a single product the whole sentence belongs to it
    // ("a Govee heater, model number H7131").
    const parts = said
      .split(/\s+and\s+/i)
      .filter((p) => PRODUCTS.some((pr) => p.toLowerCase().includes(pr)));
    const clauses = parts.length > 1 ? parts : [said];
    const registrations = clauses
      .map(parseFacts)
      .filter((f): f is Facts & { name: string } => !!f.name)
      .filter(
        (f) => !state.items.some((i) => i.name === f.name && (i.brand ?? '') === (f.brand ?? '')),
      );
    // "The car seat is a Graco" talks about something we already have: that is an update, not a new item.
    const talksAboutKnownItem = state.items.some((i) => mentions(said, i));
    const sayingWeGotSomething =
      /\b(got|bought|have|received|inherited|own|picked up|hand-me-down|second-hand|new|another|also)\b/.test(
        lower,
      );
    if (
      registrations.length > 0 &&
      !/\bis a\b.*\b(recall|safe)/.test(lower) &&
      (!talksAboutKnownItem || sayingWeGotSomething)
    ) {
      return call(
        ...registrations.map((f): [string, Record<string, unknown>] => ['add_item', args(f)]),
      );
    }

    // 10. Telling us more about something already registered
    const parsed = parseFacts(said);
    if (parsed.brand || parsed.model || parsed.year) {
      const named = state.items.find((i) => mentions(said, i));
      const target = named ?? [...state.items].reverse().find(incomplete) ?? state.items.at(-1);
      if (target) {
        const patch = compact({ brand: parsed.brand, model: parsed.model, year: parsed.year });
        return call(['update_item', { item_id: target.id, ...patch }]);
      }
    }

    return text('I can keep track of what you own and watch for recalls. What did you get?');
  }
}
