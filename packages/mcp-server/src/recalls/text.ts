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
