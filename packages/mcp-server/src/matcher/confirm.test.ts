import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../test/corpus.js';
import { ITEMS } from '../../test/matcher-items.js';
import {
  applyVerdict,
  BedrockConfirmer,
  buildPrompt,
  cacheKey,
  CachedConfirmer,
  confirmMatches,
  parseVerdict,
  ScriptedConfirmer,
  type Confirmer,
  type Verdict,
} from './confirm.js';
import { findMatches, matchItem, type Item, type Match } from './match.js';

const corpus = loadCorpus();
const byId = (id: string) => corpus.find((r) => r.id === id)!;

const govee: Item = { name: 'space heater', brand: 'Govee', model: 'H7131' };
const strong = matchItem(govee, byId('cpsc:10086'))!;
const open = matchItem({ name: 'space heater', brand: 'Govee' }, byId('cpsc:10086'))!;

const verdict = (v: Partial<Verdict>): Verdict => ({
  match: 'unsure',
  confidence: 0.5,
  reason: 'r',
  ...v,
});

describe('prompt', () => {
  it('contains the recall facts, the owner item and the automatic result', () => {
    const prompt = buildPrompt({ ...govee, year: 2023 }, strong);
    expect(prompt).toContain('title: GoveeLife and Govee Smart Electric Space Heaters');
    expect(prompt).toContain('listed models: H7130');
    expect(prompt).toContain('brand: Govee');
    expect(prompt).toContain('model: H7131');
    expect(prompt).toContain('year made or bought: 2023');
    expect(prompt).toContain('AUTOMATIC CHECK: strong; still open: nothing');
  });

  it('says "unknown" for what the owner did not tell us, and lists what is still open', () => {
    const prompt = buildPrompt({ name: 'space heater', brand: 'Govee' }, open);
    expect(prompt).toContain('model: unknown');
    expect(prompt).toContain('year made or bought: unknown');
    expect(prompt).toContain('AUTOMATIC CHECK: possible; still open: model');
  });
});

describe('parseVerdict', () => {
  it('reads a plain, fenced or chatty JSON answer', () => {
    const json =
      '{"match":"yes","confidence":0.93,"reason":"Model H7131 is listed.","clarifying_question":""}';
    expect(parseVerdict(json)).toEqual({
      match: 'yes',
      confidence: 0.93,
      reason: 'Model H7131 is listed.',
    });
    expect(parseVerdict('```json\n' + json + '\n```').match).toBe('yes');
    expect(parseVerdict('Sure! ' + json + ' Hope that helps.').match).toBe('yes');
  });

  it('keeps the clarifying question and clamps confidence to 0..1', () => {
    const v = parseVerdict(
      '{"match":"unsure","confidence":7,"reason":"x","clarifying_question":" What year? "}',
    );
    expect(v).toMatchObject({ match: 'unsure', confidence: 1, clarifying_question: 'What year?' });
    expect(parseVerdict('{"match":"no","confidence":-3,"reason":"x"}').confidence).toBe(0);
  });

  it('turns anything malformed into a safe "unsure", never a "yes"', () => {
    for (const bad of [
      '',
      'no json here',
      '{"match":"maybe"}',
      '{"match":',
      '{"confidence":1}',
      '[]',
    ]) {
      const v = parseVerdict(bad);
      expect(v.match).toBe('unsure');
      expect(v.confidence).toBe(0);
    }
  });
});

describe('applyVerdict: the model can only make the answer more careful', () => {
  it('keeps a strong match the model confirms', () => {
    const out = applyVerdict(strong, verdict({ match: 'yes', confidence: 0.95 }))!;
    expect(out.level).toBe('strong');
    expect(out.downgraded).toBe(false);
  });

  it('turns a doubted strong match into a question', () => {
    for (const v of [
      verdict({ match: 'unsure', clarifying_question: 'Which size is it?' }),
      verdict({ match: 'no', confidence: 1, clarifying_question: 'Which size is it?' }),
    ]) {
      const out = applyVerdict(strong, v)!;
      expect(out.level).toBe('possible');
      expect(out.downgraded).toBe(true);
      expect(out.question).toBe('Which size is it?');
    }
  });

  it('never upgrades an open match, even when the model is sure', () => {
    const out = applyVerdict(open, verdict({ match: 'yes', confidence: 1 }))!;
    expect(out.level).toBe('possible');
  });

  it('asks the model question for an open match', () => {
    const out = applyVerdict(
      open,
      verdict({ match: 'unsure', clarifying_question: 'Where is the sticker?' }),
    )!;
    expect(out.question).toBe('Where is the sticker?');
  });

  it('drops an open match only when the model is confidently against it', () => {
    expect(applyVerdict(open, verdict({ match: 'no', confidence: 0.95 }))).toBeNull();
    expect(applyVerdict(open, verdict({ match: 'no', confidence: 0.6 }))?.level).toBe('possible');
  });
});

describe('confirmMatches', () => {
  it('leaves a match unchanged when the model call fails (an outage must not erase a warning)', async () => {
    const failing: Confirmer = {
      confirm: async () => {
        throw new Error('no access');
      },
    };
    const out = await confirmMatches(govee, [strong], failing);
    expect(out).toHaveLength(1);
    expect(out[0]?.level).toBe('strong');
    expect(out[0]?.verdict).toBeUndefined();
  });

  it('only asks about the best few matches', async () => {
    const script = new ScriptedConfirmer({}, verdict({ match: 'yes', confidence: 1 }));
    await confirmMatches(govee, [strong, strong, strong, strong, strong], script, 2);
    expect(script.calls).toHaveLength(2);
  });
});

describe('caching: one model call per distinct item x recall revision', () => {
  const yes = verdict({ match: 'yes', confidence: 0.9 });

  it('answers a repeated question from the cache', async () => {
    const inner = new ScriptedConfirmer({ 'cpsc:10086': yes });
    const cached = new CachedConfirmer(inner);
    await cached.confirm(govee, strong);
    await cached.confirm({ ...govee, brand: 'GOVEE', name: 'Space Heater' }, strong); // same facts
    expect(inner.calls).toHaveLength(1);
  });

  it('asks again when the item, the recall content or the automatic result changes', async () => {
    const inner = new ScriptedConfirmer({ 'cpsc:10086': yes });
    const cached = new CachedConfirmer(inner);
    await cached.confirm(govee, strong);
    await cached.confirm({ ...govee, year: 2023 }, strong);
    await cached.confirm(govee, {
      ...strong,
      recall: { ...strong.recall, remedy: 'A revised remedy.' },
    });
    await cached.confirm(govee, open);
    expect(inner.calls).toHaveLength(4);
    expect(cacheKey(govee, strong)).not.toBe(cacheKey(govee, open));
  });
});

describe('BedrockConfirmer', () => {
  const bedrock = mockClient(BedrockRuntimeClient);

  it('calls Converse with the cheap model, temperature 0 and the prompt, and parses the JSON', async () => {
    bedrock.reset();
    bedrock.on(ConverseCommand).resolves({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: '{"match":"yes","confidence":0.9,"reason":"Model listed."}' }],
        },
      },
    });
    const out = await new BedrockConfirmer(
      undefined,
      new BedrockRuntimeClient({ region: 'us-east-1' }),
    ).confirm(govee, strong);
    expect(out).toMatchObject({ match: 'yes', confidence: 0.9 });
    const input = bedrock.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(input.inferenceConfig).toMatchObject({ temperature: 0 });
    expect(input.system?.[0]?.text).toMatch(/ONE JSON object/);
    expect(input.messages?.[0]?.content?.[0]?.text).toContain('OWNER ITEM');
  });
});

describe('precision cannot drop: the model never adds a confident match', () => {
  const strongIds = (matches: { recall: { id: string }; level: string }[]) =>
    new Set(matches.filter((m) => m.level === 'strong').map((m) => m.recall.id));

  const confirmers: Record<string, Confirmer> = {
    'always yes': { confirm: async () => verdict({ match: 'yes', confidence: 1 }) },
    'always no': { confirm: async () => verdict({ match: 'no', confidence: 1 }) },
    'always unsure': { confirm: async () => verdict({ match: 'unsure', confidence: 0.5 }) },
    'random mix': {
      confirm: async (_item: Item, m: Match) => {
        const roll = (m.recall.id.length + m.recall.title.length) % 3;
        return verdict({ match: (['yes', 'no', 'unsure'] as const)[roll], confidence: 0.95 });
      },
    },
  };

  for (const [name, confirmer] of Object.entries(confirmers)) {
    it(`strong matches after "${name}" are a subset of the automatic ones (all ${ITEMS.length} labeled items)`, async () => {
      for (const labeled of ITEMS) {
        const before = findMatches(labeled.item, corpus);
        const after = await confirmMatches(labeled.item, before, confirmer, before.length);
        const allowed = strongIds(before);
        for (const id of strongIds(after))
          expect(allowed.has(id), `${labeled.id}: ${id}`).toBe(true);
        // and it never returns a recall the automatic check had not found
        const found = new Set(before.map((m) => m.recall.id));
        for (const m of after) expect(found.has(m.recall.id)).toBe(true);
      }
    });
  }

  it('a confirming model keeps every strong match: precision and recall are unchanged', async () => {
    let kept = 0;
    let total = 0;
    for (const labeled of ITEMS) {
      const before = findMatches(labeled.item, corpus);
      const after = await confirmMatches(
        labeled.item,
        before,
        confirmers['always yes']!,
        before.length,
      );
      total += strongIds(before).size;
      kept += strongIds(after).size;
    }
    expect(total).toBeGreaterThan(20);
    expect(kept).toBe(total);
  });
});
