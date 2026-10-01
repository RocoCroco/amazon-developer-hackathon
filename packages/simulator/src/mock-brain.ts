import type { Block, Llm, LlmReply, Msg } from './llm.js';

/**
 * A deterministic stand-in for the Claude "Alexa+ brain": a few regex intents that emit real MCP tool
 * calls. Used when Bedrock is unavailable (tests, offline demo fallback). It is NOT smart; the real
 * brain is BedrockLlm.
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
];

interface Facts {
  name?: string;
  brand?: string;
  model?: string;
  year?: number;
}

const BRAND = /\b(?:it'?s|made by|brand is|by|a|an)\s+([A-Z][A-Za-z0-9-]+)\b/;
const MODEL = /\bmodel(?:\s+(?:number|no\.?))?(?:\s+is)?\s+([A-Za-z0-9-]*\d[A-Za-z0-9-]*)/i;
const BARE_MODEL = /\b(?:it'?s|is)\s+([A-Z]{1,4}-?\d[A-Za-z0-9-]*)\b/;
const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/;

function parse(text: string): Facts {
  const lower = text.toLowerCase();
  const name = PRODUCTS.find((p) => lower.includes(p));
  const facts: Facts = {};
  if (name) {
    facts.name = name;
    const before = text.slice(0, lower.indexOf(name));
    const brand = /([A-Z][A-Za-z0-9-]+)\s+(?:[a-z-]+\s+)?$/.exec(before);
    if (brand?.[1] && !/^(We|I|My|Our|The|It)$/.test(brand[1])) facts.brand = brand[1];
  } else {
    const brand = BRAND.exec(text);
    if (brand?.[1] && !/^(I|It|We|My|Our|The|Is|Yes|No)$/.test(brand[1])) facts.brand = brand[1];
  }
  const model = MODEL.exec(text) ?? BARE_MODEL.exec(text);
  if (model?.[1]) facts.model = model[1];
  const year = YEAR.exec(text);
  if (year?.[1]) facts.year = Number(year[1]);
  return facts;
}

/** The most recent item the user told us about, rebuilt from earlier tool calls. */
function knownItem(messages: Msg[]): Facts | undefined {
  let item: Facts | undefined;
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'toolUse' && (b.name === 'add_item' || b.name === 'check_item')) {
        item = b.input as Facts;
      }
    }
  }
  return item;
}

const text = (t: string): LlmReply => ({
  content: [{ type: 'text', text: t }],
  stopReason: 'end_turn',
});
const useTool = (name: string, input: Facts): LlmReply => ({
  content: [
    {
      type: 'toolUse',
      id: `mock-${Math.random().toString(36).slice(2, 10)}`,
      name,
      input: { ...input },
    },
  ],
  stopReason: 'tool_use',
});

function compact(facts: Facts): Facts {
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)) as Facts;
}

export class RuleBasedLlm implements Llm {
  async generate({ messages }: Parameters<Llm['generate']>[0]): Promise<LlmReply> {
    const last = messages.at(-1);
    const results = last?.content.filter(
      (b): b is Extract<Block, { type: 'toolResult' }> => b.type === 'toolResult',
    );
    if (results?.length) {
      // Speak the tool's own one-sentence summary (first line of the result).
      return text((results[0]?.text.split('\n')[0] ?? '').trim());
    }

    const said =
      last?.content.find((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')?.text ??
      '';
    const parsed = parse(said);
    const known = knownItem(messages.slice(0, -1));
    const wantsCheck = /\b(recall|recalled|safe|check|anything)\b/i.test(said);

    if (parsed.name && !wantsCheck) return useTool('add_item', compact(parsed));
    if (parsed.name && wantsCheck) return useTool('check_item', compact(parsed));
    if (known && (wantsCheck || parsed.brand || parsed.model || parsed.year)) {
      return useTool('check_item', compact({ ...known, ...parsed }));
    }
    if (wantsCheck)
      return text('What would you like me to check? Tell me the product and who makes it.');
    return text('I can keep track of what you own and watch for recalls. What did you get?');
  }
}
