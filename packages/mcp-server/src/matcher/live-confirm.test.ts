import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../test/corpus.js';
import { BedrockConfirmer } from './confirm.js';
import { matchItem } from './match.js';

const corpus = loadCorpus();
const recall = (id: string) => corpus.find((r) => r.id === id)!;

/** Real Claude (Haiku 4.5) on Bedrock. Run with: npm run test:live (needs Bedrock access, BLOCKERS B1). */
describe.skipIf(!process.env.LIVE)('live Bedrock second opinion', () => {
  const confirmer = new BedrockConfirmer();

  it('confirms an exact model match', async () => {
    const item = { name: 'space heater', brand: 'Govee', model: 'H7131' };
    const v = await confirmer.confirm(item, matchItem(item, recall('cpsc:10086'))!);
    console.log('VERDICT yes-case:', JSON.stringify(v));
    expect(v.match).toBe('yes');
  }, 60_000);

  it('is unsure, with a question, when the model number is missing', async () => {
    const item = { name: 'infant car seat', brand: 'Britax', model: 'Chaperone', year: 2010 };
    const v = await confirmer.confirm(item, matchItem(item, recall('nhtsa:12C001000'))!);
    console.log('VERDICT unsure-case:', JSON.stringify(v));
    expect(v.match).toBe('unsure');
    expect(v.clarifying_question).toBeTruthy();
  }, 60_000);

  it('says no when the recall clearly excludes the item (an elixir recall vs tablets)', async () => {
    const item = { name: 'fluphenazine tablets', brand: 'Safecor Health' };
    const forced = {
      ...matchItem(
        { name: 'fluphenazine elixir', brand: 'Safecor Health' },
        recall('fda:D-0841-2026'),
      )!,
    };
    const v = await confirmer.confirm(item, forced);
    console.log('VERDICT no-case:', JSON.stringify(v));
    expect(v.match).toBe('no');
  }, 60_000);
});
