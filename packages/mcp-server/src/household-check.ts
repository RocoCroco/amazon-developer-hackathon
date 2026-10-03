import { alertFromMatch, type Alert, type AlertStore } from './alerts.js';
import { questionFor } from './matcher/clarify.js';
import { confirmMatches, type ConfirmedMatch, type Confirmer } from './matcher/confirm.js';
import { findMatches } from './matcher/match.js';
import { searchRecalls, type RecallProvider } from './recalls/provider.js';
import type { StoredItem } from './store.js';

/** The recalls that might concern one registered item, after the automatic check and second opinion. */
export interface ItemOutcome {
  item: StoredItem;
  matches: ConfirmedMatch[];
  /** Recall sources that could not be reached for this item (so "no match" is not a clean bill). */
  unavailable?: string[];
}

/**
 * Checks registered items against the recalls a provider offers: the live CPSC lookup for a spoken
 * "check everything", or just the day's new recalls for the watcher (via StaticRecallProvider).
 * Items without a brand cannot be matched and come back with no matches.
 */
export async function checkItems(
  items: StoredItem[],
  provider: RecallProvider,
  confirmer?: Confirmer,
): Promise<ItemOutcome[]> {
  const outcomes: ItemOutcome[] = [];
  for (const item of items) {
    if (!item.brand) {
      outcomes.push({ item, matches: [] });
      continue;
    }
    const { recalls, unavailable } = await searchRecalls(provider, item);
    const found = findMatches(item, recalls);
    const matches: ConfirmedMatch[] = confirmer
      ? await confirmMatches(item, found, confirmer)
      : found;
    outcomes.push({ item, matches, ...(unavailable.length ? { unavailable } : {}) });
  }
  return outcomes;
}

export interface RecordedAlerts {
  /** Alerts that did not exist before (new recalls to tell the household about). */
  created: Alert[];
  /** Every alert touched, for the spoken summary. */
  all: Alert[];
}

export interface RecordOptions {
  /**
   * True for a FULL check of the item (check_household, check_item): open questions that this check no
   * longer raises are closed as superseded. Leave false when only some recalls were examined (the daily
   * watcher sees just the new ones), or it would close alerts it never re-examined.
   */
  supersede?: boolean;
  now?: Date;
}

/**
 * Turns matches into alerts (deduplicated by item + recall) in the household's alert store.
 * Every confirmed recall gets its own alert. An item with only open questions gets ONE alert, for its
 * best candidate: asking the same question several times would be noise.
 */
export async function recordAlerts(
  store: AlertStore,
  householdId: string,
  outcomes: ItemOutcome[],
  { supersede = false, now = new Date() }: RecordOptions = {},
): Promise<RecordedAlerts> {
  const created: Alert[] = [];
  const all: Alert[] = [];
  for (const { item, matches } of outcomes) {
    const strong = matches.filter((m) => m.level === 'strong');
    const chosen = strong.length > 0 ? strong : matches.slice(0, 1);
    const keep = new Set<string>();
    for (const match of chosen) {
      const question = match.level === 'strong' ? undefined : questionFor(match, matches).question;
      const { alert, created: isNew } = await store.upsertAlert(
        householdId,
        alertFromMatch(item, match, question, now),
      );
      keep.add(alert.id);
      all.push(alert);
      if (isNew) created.push(alert);
    }
    if (supersede) {
      for (const open of await store.listAlerts(householdId, 'open')) {
        if (open.itemId === item.id && open.kind === 'need_info' && !keep.has(open.id)) {
          await store.resolveAlert(householdId, open.id, 'superseded', now);
        }
      }
    }
  }
  return { created, all };
}
