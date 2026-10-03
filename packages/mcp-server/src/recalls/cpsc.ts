import { extractModelNumbers, firmFromTitle, quotedBrands, toIsoDate } from './text.js';
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
  const products = (raw.Products ?? []).map((p) => {
    const name = p.Name ?? '';
    const models = new Set(extractModelNumbers(`${name}. ${description}`));
    if (p.Model) models.add(p.Model);
    return { name, models: [...models] };
  });
  if (products.length === 0) {
    products.push({ name: raw.Title, models: extractModelNumbers(description) });
  }

  const brands = new Set<string>();
  const firm = firmFromTitle(raw.Title);
  if (firm) brands.add(firm);
  for (const b of quotedBrands(description)) brands.add(b);
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

/** Fetch CPSC recalls published on/after `since` (YYYY-MM-DD). `fetchFn` is injectable for tests. */
export async function fetchCpscRecalls(
  since: string,
  fetchFn: FetchLike = (url) => fetch(url),
): Promise<Recall[]> {
  const url = `${BASE_URL}?format=json&LastPublishDateStart=${encodeURIComponent(since)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`CPSC API returned HTTP ${res.status}`);
  const body = (await res.json()) as CpscRecall[];
  return body.map(fromCpsc);
}
