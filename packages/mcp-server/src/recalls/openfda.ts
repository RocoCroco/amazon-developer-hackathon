import { createHash } from 'node:crypto';
import type { FetchLike } from './cpsc.js';
import { toIsoDate } from './text.js';
import type { Recall, RecallCategory, Severity } from './types.js';

export type OpenFdaKind = 'food' | 'drug';

const CATEGORY: Record<OpenFdaKind, RecallCategory> = { food: 'food', drug: 'drug' };

/** Subset of an openFDA enforcement report (see docs/data-sources.md). One record per product. */
export interface OpenFdaRecord {
  /** Usually "H-1339-2026", but openFDA sometimes returns "N/A" or nothing. */
  recall_number?: string;
  event_id?: string;
  recalling_firm?: string;
  product_description?: string;
  reason_for_recall?: string;
  classification?: string; // "Class I" | "Class II" | "Class III"
  report_date?: string; // YYYYMMDD
  code_info?: string;
  distribution_pattern?: string;
  status?: string;
}

const SEVERITY: Record<string, Severity> = {
  'class i': 'high',
  'class ii': 'medium',
  'class iii': 'low',
};

// openFDA enforcement reports carry no consumer remedy text, so this is generic, careful guidance.
const REMEDY: Record<OpenFdaKind, string> = {
  food:
    'Check the lot or date code on the package. If it matches, do not eat it. Throw it away or return it ' +
    'to the store, and contact the company for a refund.',
  drug:
    'Check the lot number on the package. Do not stop taking a prescription medicine on your own: ' +
    'call your pharmacist or doctor first, and ask whether your lot is affected.',
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;

const titleOf = (firm: string, description: string) =>
  `${firm || 'Company'} recalls ${clip(description.split(/[.,;]/)[0] ?? description, 90)}`;

/**
 * Stable key of the recall a record belongs to. The recall number is preferred; openFDA also has
 * records whose number is "N/A" (seen in both the food and drug feeds), which must NOT be merged with
 * each other, so those fall back to the event id and finally to a hash of the record's content.
 */
export function recallKey(r: OpenFdaRecord): string {
  const number = (r.recall_number ?? '').trim();
  if (number && number.toUpperCase() !== 'N/A') return number;
  if (r.event_id) return `event-${r.event_id}`;
  const content = `${r.recalling_firm}|${r.product_description}|${r.report_date}`;
  return `hash-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`;
}

/** Groups per-product records into one Recall per recall. */
export function fromOpenFda(records: OpenFdaRecord[], kind: OpenFdaKind): Recall[] {
  const byNumber = new Map<string, OpenFdaRecord[]>();
  for (const r of records) byNumber.set(recallKey(r), [...(byNumber.get(recallKey(r)) ?? []), r]);

  return [...byNumber.entries()].map(([number, group]) => {
    const first = group[0]!;
    const firm = (first.recalling_firm ?? '').trim();
    const codes = [...new Set(group.map((r) => (r.code_info ?? '').trim()).filter(Boolean))];
    const lots = codes.length ? ` Lot or code info: ${clip(codes.join(' | '), 400)}` : '';
    const where = first.distribution_pattern
      ? ` Distributed: ${clip(first.distribution_pattern, 160)}`
      : '';
    return {
      id: `fda:${number}`,
      source: 'fda',
      sourceId: number,
      category: CATEGORY[kind],
      title: titleOf(firm, first.product_description ?? ''),
      summary:
        `${group.map((r) => clip((r.product_description ?? '').trim(), 300)).join(' | ')}${lots}${where}`.trim(),
      hazard: (first.reason_for_recall ?? '').trim(),
      remedy: REMEDY[kind],
      remedyOptions: ['other'],
      contact: '',
      url: 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
      publishedAt: toIsoDate(first.report_date ?? ''),
      brands: firm ? [firm] : [],
      products: group.map((r) => ({
        name: clip((r.product_description ?? '').trim(), 200),
        models: [],
      })),
      years: [],
      severity: SEVERITY[(first.classification ?? '').toLowerCase()],
    } satisfies Recall;
  });
}

const PAGE = 100;
const MAX_PAGES = 20;

/**
 * Enforcement reports with report_date in [since, until] (YYYYMMDD), newest first, paged.
 * openFDA answers 404 when nothing matches; that is an empty result, not an error.
 */
export async function fetchOpenFdaRecalls(
  kind: OpenFdaKind,
  since: string,
  until: string,
  fetchFn: FetchLike = (url) => fetch(url),
): Promise<Recall[]> {
  const records: OpenFdaRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    // '+' is how openFDA spells a space in the query; it must not be percent-encoded.
    const url =
      `https://api.fda.gov/${kind}/enforcement.json?search=report_date:[${since}+TO+${until}]` +
      `&sort=report_date:desc&limit=${PAGE}&skip=${page * PAGE}`;
    const res = await fetchFn(url);
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`openFDA returned HTTP ${res.status}`);
    const body = (await res.json()) as { results?: OpenFdaRecord[] };
    const results = body.results ?? [];
    records.push(...results);
    if (results.length < PAGE) break;
  }
  return fromOpenFda(records, kind);
}
