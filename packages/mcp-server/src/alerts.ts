import { createHash } from 'node:crypto';
import type { ConfirmedMatch } from './matcher/confirm.js';
import type { Missing } from './matcher/match.js';
import { severityOf, severityRank } from './recalls/severity.js';
import type { RecallCategory, RemedyOption, Severity } from './recalls/types.js';
import type { StoredItem } from './store.js';

/**
 * Why we are bothering the household about an item:
 *  recalled   the item is covered by a recall (a strong match)
 *  need_info  a recall might cover it, and one more detail would settle it
 */
export type AlertKind = 'recalled' | 'need_info';

export type AlertStatus = 'open' | 'resolved';

/** How a household closed an alert. */
export type Resolution = 'fixed' | 'stopped_using' | 'not_affected' | 'dismissed' | 'superseded';

/** What the alert needs to show and explain a recall later, without fetching the recall again. */
export interface RecallSnapshot {
  id: string;
  source: string;
  category: RecallCategory;
  title: string;
  hazard: string;
  remedy: string;
  remedyOptions: RemedyOption[];
  contact: string;
  url: string;
  publishedAt: string;
}

export interface Alert {
  /** Deterministic from item + recall, so checking again never duplicates an alert. */
  id: string;
  itemId: string;
  /** What the item is called when spoken ("Graco car seat"). */
  itemName: string;
  recallId: string;
  kind: AlertKind;
  severity: Severity;
  status: AlertStatus;
  createdAt: string;
  resolvedAt?: string;
  resolution?: Resolution;
  /** For need_info alerts: what is still open and the question to ask. */
  missing?: Missing[];
  question?: string;
  recall: RecallSnapshot;
}

export interface UpsertAlertResult {
  alert: Alert;
  /** True when this alert did not exist before (the watcher notifies on these). */
  created: boolean;
}

export interface AlertStore {
  /**
   * Creates the alert, or refreshes an existing one. A resolved alert stays resolved, unless the
   * situation got worse (a need_info alert became a confirmed recall): then it reopens.
   */
  upsertAlert(householdId: string, alert: Alert): Promise<UpsertAlertResult>;
  listAlerts(householdId: string, status?: AlertStatus): Promise<Alert[]>;
  getAlert(householdId: string, alertId: string): Promise<Alert | undefined>;
  resolveAlert(
    householdId: string,
    alertId: string,
    resolution: Resolution,
    now?: Date,
  ): Promise<Alert | undefined>;
}

export function alertId(itemId: string, recallId: string): string {
  return createHash('sha256').update(`${itemId}|${recallId}`).digest('hex').slice(0, 16);
}

/** Builds the alert for one match of one registered item. */
export function alertFromMatch(
  item: StoredItem,
  match: ConfirmedMatch,
  question: string | undefined,
  now: Date,
): Alert {
  const r = match.recall;
  return {
    id: alertId(item.id, r.id),
    itemId: item.id,
    itemName: [item.brand, item.name].filter(Boolean).join(' '),
    recallId: r.id,
    kind: match.level === 'strong' ? 'recalled' : 'need_info',
    severity: severityOf(r),
    status: 'open',
    createdAt: now.toISOString(),
    ...(match.level === 'strong' ? {} : { missing: match.missing, question }),
    recall: {
      id: r.id,
      source: r.source,
      category: r.category,
      title: r.title,
      hazard: r.hazard,
      remedy: r.remedy,
      remedyOptions: r.remedyOptions,
      contact: r.contact,
      url: r.url,
      publishedAt: r.publishedAt,
    },
  };
}

/** Confirmed recalls first, then by severity, then newest recall first. */
export function compareAlerts(a: Alert, b: Alert): number {
  const kind = Number(a.kind !== 'recalled') - Number(b.kind !== 'recalled');
  return (
    kind ||
    severityRank(a.severity) - severityRank(b.severity) ||
    b.recall.publishedAt.localeCompare(a.recall.publishedAt)
  );
}

/** Merge rule shared by every store. */
export function mergeAlert(existing: Alert | undefined, incoming: Alert): UpsertAlertResult {
  if (!existing) return { alert: incoming, created: true };
  // A confirmed recall is never downgraded by a later, less certain look (e.g. a flapping second opinion).
  if (existing.kind === 'recalled' && incoming.kind === 'need_info')
    return { alert: existing, created: false };
  const worse = existing.kind === 'need_info' && incoming.kind === 'recalled';
  if (existing.status === 'resolved' && !worse) return { alert: existing, created: false };
  // Keep identity and history (createdAt); take the fresh facts.
  const merged: Alert = {
    ...incoming,
    createdAt: existing.createdAt,
    status: 'open',
  };
  return { alert: merged, created: worse };
}

export class InMemoryAlertStore implements AlertStore {
  private readonly alerts = new Map<string, Map<string, Alert>>();

  private household(householdId: string): Map<string, Alert> {
    let map = this.alerts.get(householdId);
    if (!map) {
      map = new Map();
      this.alerts.set(householdId, map);
    }
    return map;
  }

  async upsertAlert(householdId: string, alert: Alert): Promise<UpsertAlertResult> {
    const map = this.household(householdId);
    const result = mergeAlert(map.get(alert.id), alert);
    map.set(alert.id, result.alert);
    return result;
  }

  async listAlerts(householdId: string, status?: AlertStatus): Promise<Alert[]> {
    return [...this.household(householdId).values()]
      .filter((a) => !status || a.status === status)
      .sort(compareAlerts);
  }

  async getAlert(householdId: string, alertId: string): Promise<Alert | undefined> {
    return this.household(householdId).get(alertId);
  }

  async resolveAlert(
    householdId: string,
    alertId: string,
    resolution: Resolution,
    now = new Date(),
  ): Promise<Alert | undefined> {
    const map = this.household(householdId);
    const alert = map.get(alertId);
    if (!alert) return undefined;
    const resolved: Alert = {
      ...alert,
      status: 'resolved',
      resolution,
      resolvedAt: now.toISOString(),
    };
    map.set(alertId, resolved);
    return resolved;
  }
}
