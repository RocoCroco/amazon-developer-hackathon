/** Date-only ISO string from `2024-11-07T00:00:00`, `20240614` or `04/11/2020`; '' if unparseable. */
export function toIsoDate(value: string): string {
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return '';
}

/**
 * Pulls model-number-like tokens (must contain a digit and a letter) from clauses that talk about
 * models, e.g. "Model Numbers H7130 (including the H7130101 variation), H7131, H7132".
 */
export function extractModelNumbers(text: string): string[] {
  const found = new Set<string>();
  const clauses = text.match(/\bmodels?(?:\s+(?:numbers?|names?|nos?\.?))?\b[^.;]*/gi) ?? [];
  for (const clause of clauses) {
    for (const token of clause.match(/\b[A-Z0-9][A-Z0-9-]{2,}\b/g) ?? []) {
      if (/\d/.test(token) && /[A-Z]/.test(token)) found.add(token);
    }
  }
  return [...found];
}

/** Brand/firm name from a CPSC-style title: "Acme Recalls Widgets Due to ..." -> "Acme". */
export function firmFromTitle(title: string): string {
  const m = /^(.+?)\s+Recalls?\b/i.exec(title.trim());
  return m?.[1]?.trim() ?? '';
}

/**
 * Brand names quoted in sentences that describe markings, e.g.
 * `"GoveeLife" or "Govee" is printed on the front` -> ['GoveeLife', 'Govee'].
 */
export function quotedBrands(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (
      !/\b(printed|labeled|labelled|branded|brand|logo|engraved|stamped|name)\b/i.test(sentence)
    ) {
      continue;
    }
    for (const m of sentence.matchAll(/["“]([A-Z][^"”]{1,30})["”]/g)) {
      if (m[1]) found.add(m[1].trim());
    }
  }
  return [...found];
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH =
  '(january|february|march|april|may|june|july|august|september|october|november|december)';
const DATE = String.raw`${MONTH}\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})`;
const RANGE = new RegExp(
  String.raw`\b(?:between|from)\s+${DATE}\s*,?\s*(?:and|through|to|-)\s+${DATE}`,
  'i',
);

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Manufacturing/sale window from recall prose, e.g. "manufactured between July 2010 and May 2013" or
 * "built from November 24, 2009, through April 9, 2010". Month-only dates cover the whole month.
 */
export function extractDateRange(text: string): { from: string; to: string } | undefined {
  const m = RANGE.exec(text);
  if (!m) return undefined;
  const month = (name: string | undefined) => MONTHS.indexOf((name ?? '').toLowerCase()) + 1;
  const [m1, d1, y1, m2, d2, y2] = [
    month(m[1]),
    m[2],
    Number(m[3]),
    month(m[4]),
    m[5],
    Number(m[6]),
  ];
  return {
    from: iso(y1, m1, d1 ? Number(d1) : 1),
    to: iso(y2, m2, d2 ? Number(d2) : lastDayOf(y2, m2)),
  };
}

/**
 * Model-number prefixes from prose like "model numbers beginning with 310" -> ['310'].
 * A prefix needs a digit, so words are never mistaken for prefixes.
 */
export function extractModelPrefixes(text: string): string[] {
  const found = new Set<string>();
  const pattern =
    /\bmodel(?:\s+(?:numbers?|nos?\.?))?\s+(?:beginning|starting)\s+with\s+([A-Z0-9-]{2,})/gi;
  for (const m of text.matchAll(pattern)) {
    const prefix = m[1]?.toUpperCase();
    if (prefix && /\d/.test(prefix)) found.add(prefix);
  }
  return [...found];
}
