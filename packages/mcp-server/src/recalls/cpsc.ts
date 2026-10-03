import {
  extractModelNumbers,
  firmFromTitle,
  quotedBrands,
  toIsoDate,
  brandFromProduct,
  quotedCodes,
} from './text.js';
import type { Recall, RemedyOption } from './types.js';

const BASE_URL = 'https://www.saferproducts.gov/RestWebServices/Recall';

interface CpscNamed {
  Name?: string;
}

/** Subset of the CPSC recall JSON we use (see docs/data-sources.md). */
export interface CpscRecall {
  RecallID: number;
  RecallNumber?: string;
  RecallDate: string;
  LastPublishDate?: string;
  Title: string;
  Description?: string;
  URL?: string;
  ConsumerContact?: string;
  Products?: { Name?: string; Model?: string }[];
  Hazards?: CpscNamed[];
  Remedies?: CpscNamed[];
  RemedyOptions?: { Option?: string }[];
  Manufacturers?: CpscNamed[];
  Importers?: CpscNamed[];
  Images?: { URL?: string; Caption?: string }[];
}

const REMEDY_MAP: Record<string, RemedyOption> = {
  repair: 'repair',
  replace: 'replace',
  refund: 'refund',
};

/** "Shenzhen X Co., Ltd., d/b/a NEWDERY, of China" -> "NEWDERY"; "Acme Inc., of Ohio" -> "Acme Inc." */
function companyName(raw: string): string {
  const dba = /d\/b\/a\s+([^,]+)/i.exec(raw);
  if (dba?.[1]) return dba[1].trim();
  return raw.replace(/,?\s+of\s+[^,]+(?:,\s*[A-Za-z ]+)?$/i, '').trim();
}

export function fromCpsc(raw: CpscRecall): Recall {
  const description = raw.Description ?? '';
  const skus = quotedCodes(description);
  const products = (raw.Products ?? []).map((p) => {
    const name = p.Name ?? '';
    const models = new Set([...extractModelNumbers(`${name}. ${description}`), ...skus]);
    if (p.Model) models.add(p.Model);
    return { name, models: [...models] };
  });
  if (products.length === 0) {
    products.push({
      name: raw.Title,
      models: [...new Set([...extractModelNumbers(description), ...skus])],
    });
  }

  const brands = new Set<string>();
  const firm = firmFromTitle(raw.Title);
  if (firm) brands.add(firm);
  for (const b of quotedBrands(description)) brands.add(b);
  for (const p of raw.Products ?? []) {
    const sold = brandFromProduct(raw.Title ?? '', p.Name ?? '');
    if (sold) brands.add(sold);
  }
  for (const c of [...(raw.Manufacturers ?? []), ...(raw.Importers ?? [])]) {
    if (c.Name) brands.add(companyName(c.Name));
  }

  const remedyOptions = [
    ...new Set(
      (raw.RemedyOptions ?? []).map((o) => REMEDY_MAP[(o.Option ?? '').toLowerCase()] ?? 'other'),
    ),
  ];

  const imageUrl = (raw.Images ?? []).map((i) => i.URL ?? '').find((u) => u.startsWith('https://'));
  return {
    id: `cpsc:${raw.RecallID}`,
    source: 'cpsc',
    sourceId: String(raw.RecallID),
    category: 'consumer',
    title: raw.Title,
    summary: description,
    hazard: (raw.Hazards ?? []).map((h) => h.Name ?? '').join(' '),
    remedy: (raw.Remedies ?? []).map((r) => r.Name ?? '').join(' '),
    remedyOptions,
    contact: raw.ConsumerContact ?? '',
    url: raw.URL ?? '',
    ...(imageUrl ? { imageUrl } : {}),
    publishedAt: toIsoDate(raw.LastPublishDate || raw.RecallDate),
    brands: [...brands],
    products,
    years: [],
  };
}

export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Live lookups give up after this long: a hanging government API must not stall a whole conversation. */
export const LOOKUP_TIMEOUT_MS = 6_000;
/** Feed downloads in the daily watcher may take longer. */
export const FEED_TIMEOUT_MS = 30_000;

/** fetch() that gives up after `ms` (the error then counts as "source unavailable"). */
export const fetchWithin =
  (ms: number): FetchLike =>
  (url) =>
    fetch(url, { signal: AbortSignal.timeout(ms) });

/**
 * Fetch CPSC recalls with a recall date in [since, until] (YYYY-MM-DD; until optional). `fetchFn` is injectable
 * for tests. We filter on RecallDate: since 2026-10-03 the API answers HTTP 503 to every LastPublishDate
 * query while RecallDate queries work (FRICTION_LOG F18). Revisions of old recalls are missed; new ones are not.
 */
export async function fetchCpscRecalls(
  since: string,
  fetchFn: FetchLike = fetchWithin(FEED_TIMEOUT_MS),
  until?: string,
): Promise<Recall[]> {
  const range =
    `RecallDateStart=${encodeURIComponent(since)}` +
    (until ? `&RecallDateEnd=${encodeURIComponent(until)}` : '');
  const res = await fetchFn(`${BASE_URL}?format=json&${range}`);
  if (!res.ok) throw new Error(`CPSC API returned HTTP ${res.status}`);
  const body = (await res.json()) as CpscRecall[];
  return body.map(fromCpsc);
}
