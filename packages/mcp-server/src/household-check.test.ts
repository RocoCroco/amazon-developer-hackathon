import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../test/corpus.js';
import { InMemoryAlertStore } from './alerts.js';
import { checkItems, recordAlerts } from './household-check.js';
import { StaticRecallProvider } from './recalls/provider.js';
import type { StoredItem } from './store.js';

const corpus = loadCorpus();
const provider = new StaticRecallProvider(corpus);
const item = (id: string, fields: Omit<StoredItem, 'id' | 'createdAt'>): StoredItem => ({
  id,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...fields,
});

describe('checkItems', () => {
  it('leaves items without a brand unchecked', async () => {
    const out = await checkItems([item('a', { name: 'car seat' })], provider);
    expect(out[0]?.matches).toEqual([]);
  });

  it('finds matches per item', async () => {
    const heater = item('h', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    const lamp = item('l', { name: 'desk lamp', brand: 'Govee' });
    const [h, l] = await checkItems([heater, lamp], new StaticRecallProvider(corpus));
    expect(h?.matches[0]?.level).toBe('strong');
    expect(l?.matches).toEqual([]);
  });
});

describe('recordAlerts', () => {
  const seat = item('seat', { name: 'car seat', brand: 'Graco' });

  it('gives one alert to an item that only has open questions (its best candidate)', async () => {
    const store = new InMemoryAlertStore();
    const outcomes = await checkItems([seat], provider);
    expect(outcomes[0]!.matches.length).toBeGreaterThan(1); // many Graco recalls could apply
    const { all } = await recordAlerts(store, 'hh', outcomes);
    expect(all).toHaveLength(1);
    expect(all[0]?.kind).toBe('need_info');
    expect(all[0]?.question).toBeTruthy();
  });

  it('gives every confirmed recall its own alert, and no question alerts next to them', async () => {
    const store = new InMemoryAlertStore();
    const camry = item('car', { name: 'car', brand: 'Toyota', model: 'Camry', year: 2020 });
    const outcomes = await checkItems([camry], provider);
    const strong = outcomes[0]!.matches.filter((m) => m.level === 'strong');
    expect(strong.length).toBeGreaterThan(1);
    const { all, created } = await recordAlerts(store, 'hh', outcomes);
    expect(all).toHaveLength(strong.length);
    expect(created).toHaveLength(strong.length);
    expect(all.every((a) => a.kind === 'recalled')).toBe(true);
    // The same check again creates nothing new.
    expect((await recordAlerts(store, 'hh', outcomes)).created).toEqual([]);
  });

  it('a full check closes questions it no longer raises; a partial one (the watcher) does not', async () => {
    const outcomes = await checkItems([seat], provider);
    const first = outcomes[0]!.matches[0]!;
    const other = outcomes[0]!.matches[1]!;

    for (const supersede of [true, false]) {
      const store = new InMemoryAlertStore();
      // An older question alert for a different candidate recall of the same item is open.
      await recordAlerts(store, 'hh', [{ item: seat, matches: [other] }]);
      expect(await store.listAlerts('hh', 'open')).toHaveLength(1);
      // Now the best candidate is a different recall.
      await recordAlerts(store, 'hh', [{ item: seat, matches: [first] }], { supersede });
      const open = await store.listAlerts('hh', 'open');
      expect(open).toHaveLength(supersede ? 1 : 2);
      if (supersede) {
        expect(open[0]?.recallId).toBe(first.recall.id);
        expect((await store.listAlerts('hh', 'resolved'))[0]?.resolution).toBe('superseded');
      }
    }
  });

  it('never closes a confirmed recall as superseded', async () => {
    const store = new InMemoryAlertStore();
    const heater = item('h', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    const outcomes = await checkItems([heater], provider);
    await recordAlerts(store, 'hh', outcomes);
    // A later check that finds nothing for this item must leave the recall alert alone.
    await recordAlerts(store, 'hh', [{ item: heater, matches: [] }], { supersede: true });
    expect((await store.listAlerts('hh', 'open'))[0]?.kind).toBe('recalled');
  });
});
