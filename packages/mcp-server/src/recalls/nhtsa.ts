import { extractDateRange, extractModelNumbers, extractModelPrefixes, toIsoDate } from './text.js';
import type { FetchLike } from './cpsc.js';
import type { Recall, RecallCategory, RecalledProduct, RemedyOption } from './types.js';

const API_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
const recallPage = (campaign: string) => `https://www.nhtsa.gov/recalls?nhtsaId=${campaign}`;

/** Remedy options named in free text ("will replace the buckle ... free of charge"). */
export function remedyOptionsFrom(text: string): RemedyOption[] {
  const found: RemedyOption[] = [];
  if (/\b(replace|replacement)\b/i.test(text)) found.push('replace');
  if (/\b(repair|reinforc|install|update|reprogram|inspect|kit|recondition)/i.test(text)) {
    found.push('repair');
  }
  if (/\b(refund|reimburs)/i.test(text)) found.push('refund');
  return found.length ? found : ['other'];
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());

// ---------------------------------------------------------------------------------------------
// Vehicles: api.nhtsa.gov/recalls/recallsByVehicle (one result per campaign x make x model x year)
// ---------------------------------------------------------------------------------------------

export interface NhtsaVehicleResult {
  Manufacturer?: string;
  NHTSACampaignNumber: string;
  ReportReceivedDate?: string;
  Component?: string;
  Summary?: string;
  Consequence?: string;
  Remedy?: string;
  Notes?: string;
  ModelYear?: string;
  Make?: string;
  Model?: string;
  parkIt?: boolean;
  parkOutSide?: boolean;
}

/** Groups API results into one Recall per campaign, keeping model years per product line. */
export function fromNhtsaVehicleResults(results: NhtsaVehicleResult[]): Recall[] {
  const byCampaign = new Map<string, NhtsaVehicleResult[]>();
  for (const r of results) {
    byCampaign.set(r.NHTSACampaignNumber, [...(byCampaign.get(r.NHTSACampaignNumber) ?? []), r]);
  }
  return [...byCampaign.entries()].map(([campaign, rows]) => {
    const first = rows[0]!;
    const brands = new Set<string>();
    const products = new Map<string, RecalledProduct>();
    for (const r of rows) {
      const make = titleCase(r.Make ?? '');
      if (make) brands.add(make);
      const key = `${make}|${r.Model ?? ''}`;
      const product = products.get(key) ?? {
        name: `${make} ${titleCase(r.Model ?? '')}`.trim(),
        models: [],
        years: [],
      };
      if (r.Model && !product.models.includes(r.Model)) product.models.push(r.Model);
      const year = Number(r.ModelYear);
      if (year && !product.years!.includes(year)) product.years!.push(year);
      products.set(key, product);
    }
    const years = [...new Set([...products.values()].flatMap((p) => p.years ?? []))].sort();
    const remedy = first.Remedy ?? '';
    const advisory = first.parkIt
      ? ' Do not drive the vehicle.'
      : first.parkOutSide
        ? ' Park the vehicle outside.'
        : '';
    return {
      id: `nhtsa:${campaign}`,
      source: 'nhtsa',
      sourceId: campaign,
      category: 'vehicle',
      title: `${[...brands].join(', ') || first.Manufacturer || 'Vehicle'} recall: ${titleCase(first.Component ?? 'safety defect')}`,
      summary: first.Summary ?? '',
      hazard: `${first.Consequence ?? ''}${advisory}`.trim(),
      remedy,
      remedyOptions: remedyOptionsFrom(remedy),
      contact: first.Notes ?? '',
      url: recallPage(campaign),
      publishedAt: toIsoDate(first.ReportReceivedDate ?? ''),
      brands: [...brands],
      products: [...products.values()],
      years,
    } satisfies Recall;
  });
}

/** Recalls for one make/model/year from the NHTSA API. `fetchFn` is injectable for tests. */
export async function fetchVehicleRecalls(
  vehicle: { make: string; model: string; year: number },
  fetchFn: FetchLike = (url) => fetch(url),
): Promise<Recall[]> {
  const query = new URLSearchParams({
    make: vehicle.make,
    model: vehicle.model,
    modelYear: String(vehicle.year),
  });
  const res = await fetchFn(`${API_URL}?${query}`);
  if (!res.ok) throw new Error(`NHTSA API returned HTTP ${res.status}`);
  const body = (await res.json()) as { results?: NhtsaVehicleResult[] };
  return fromNhtsaVehicleResults(body.results ?? []);
}

// ---------------------------------------------------------------------------------------------
// Bulk flat file (child seats, equipment, tires, vehicles): tab-delimited, see docs/data-sources.md
// ---------------------------------------------------------------------------------------------

export interface FlatRow {
  campaign: string;
  make: string;
  model: string;
  /** 9999 / empty in the file means unknown. */
  year?: number;
  type: 'V' | 'E' | 'C' | 'T';
  manufacturer: string;
  begin: string;
  end: string;
  received: string;
  defect: string;
  consequence: string;
  corrective: string;
  notes: string;
}

/** Parses one line of the flat file; undefined for malformed lines or unknown record types. */
export function parseFlatLine(line: string): FlatRow | undefined {
  const f = line.split('\t');
  const type = f[10];
  if (f.length < 23 || (type !== 'V' && type !== 'E' && type !== 'C' && type !== 'T')) {
    return undefined;
  }
  const year = Number(f[4]);
  return {
    campaign: (f[1] ?? '').trim(),
    make: (f[2] ?? '').trim(),
    model: (f[3] ?? '').trim(),
    year: year && year !== 9999 ? year : undefined,
    type,
    manufacturer: (f[7] ?? '').trim(),
    begin: toIsoDate(f[8] ?? ''),
    end: toIsoDate(f[9] ?? ''),
    received: toIsoDate(f[15] ?? ''),
    defect: (f[19] ?? '').trim(),
    consequence: (f[20] ?? '').trim(),
    corrective: (f[21] ?? '').trim(),
    notes: (f[22] ?? '').trim(),
  };
}

const CATEGORY: Record<FlatRow['type'], RecallCategory> = {
  V: 'vehicle',
  C: 'car_seat',
  E: 'equipment',
  T: 'tire',
};

const LABEL: Record<FlatRow['type'], string> = {
  V: 'vehicle',
  C: 'child car seat',
  E: 'equipment',
  T: 'tire',
};

/** Groups flat-file rows (one per make x model) into one Recall per campaign. */
export function flatRowsToRecalls(rows: FlatRow[]): Recall[] {
  const byCampaign = new Map<string, FlatRow[]>();
  for (const r of rows) byCampaign.set(r.campaign, [...(byCampaign.get(r.campaign) ?? []), r]);

  return [...byCampaign.entries()].map(([campaign, group]) => {
    const first = group[0]!;
    const brands = new Set<string>();
    const products = new Map<string, RecalledProduct>();
    for (const r of group) {
      const make = titleCase(r.make);
      if (make) brands.add(make);
      if (r.manufacturer) brands.add(titleCase(r.manufacturer));
      const key = `${r.make}|${r.model}`;
      const product = products.get(key) ?? {
        name: `${make} ${titleCase(r.model)}`.trim(),
        models: [],
        years: [],
      };
      if (r.model && !product.models.includes(r.model)) product.models.push(r.model);
      if (r.year && !product.years!.includes(r.year)) product.years!.push(r.year);
      products.set(key, product);
    }
    // Model numbers and prefixes named only in the prose apply to the whole campaign.
    const textModels = extractModelNumbers(first.defect);
    const prefixes = extractModelPrefixes(first.defect);
    for (const product of products.values()) {
      for (const m of textModels) if (!product.models.includes(m)) product.models.push(m);
      if (prefixes.length) product.modelPrefixes = prefixes;
    }
    const window =
      first.begin && first.end
        ? { from: first.begin, to: first.end }
        : extractDateRange(first.defect);
    const label = LABEL[first.type];
    const firm = titleCase(first.manufacturer || first.make);
    return {
      id: `nhtsa:${campaign}`,
      source: 'nhtsa',
      sourceId: campaign,
      category: CATEGORY[first.type],
      title: `${firm} ${label} recall`,
      summary: first.defect,
      hazard: first.consequence,
      remedy: first.corrective,
      remedyOptions: remedyOptionsFrom(first.corrective),
      contact: first.notes,
      url: recallPage(campaign),
      publishedAt: first.received,
      brands: [...brands],
      products: [...products.values()],
      years: [...new Set([...products.values()].flatMap((p) => p.years ?? []))].sort(),
      ...(window ? { manufacturedFrom: window.from, manufacturedTo: window.to } : {}),
    } satisfies Recall;
  });
}

/** Convenience: parse many lines, dropping malformed ones. */
export function parseFlatFile(lines: Iterable<string>): Recall[] {
  const rows: FlatRow[] = [];
  for (const line of lines) {
    const row = parseFlatLine(line);
    if (row) rows.push(row);
  }
  return flatRowsToRecalls(rows);
}
