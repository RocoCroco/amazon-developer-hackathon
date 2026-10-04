const CORPORATE_WORDS = new Set([
  'inc',
  'llc',
  'ltd',
  'limited',
  'co',
  'corp',
  'corporation',
  'company',
  'gmbh',
  'the',
  'of',
  'and',
]);

/** Common brand spellings -> canonical brand token(s). Extend as real data shows gaps. */
const BRAND_ALIASES: Record<string, string> = {
  'graco childrens products': 'graco',
  'fisher price': 'fisherprice',
  'fisher-price': 'fisherprice',
  'black decker': 'blackdecker',
  'black plus decker': 'blackdecker',
};

/**
 * Lowercase, strip accents/punctuation, collapse whitespace. Apostrophes are dropped, not split. A "+" is a
 * word: "Tread+" is "tread plus", a different product from the "Tread".
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalized text with the multi-word brand aliases joined ("fisher price" -> "fisherprice"). */
export function applyBrandAliases(normalized: string): string {
  let text = ` ${normalized} `;
  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    if (alias.includes(' ')) text = text.split(` ${alias} `).join(` ${canonical} `);
  }
  return text.trim();
}

/**
 * Whether a normalized brand appears in normalized recall text, also when the brand has a canonical alias:
 * the owner's "Fisher-Price" is "fisherprice", the recall text says "fisher price".
 */
export function brandInText(haystack: string, brand: string): boolean {
  if (containsPhrase(haystack, brand)) return true;
  // Rewriting the text only helps for a canonical alias ("fisherprice"), and it is the slow part.
  return ALIAS_TARGETS.has(brand) && containsPhrase(applyBrandAliases(haystack), brand);
}

const ALIAS_TARGETS = new Set(Object.values(BRAND_ALIASES));

/** Removes corporate filler (inc, llc, the, and...) from already normalized text. */
export function dropCorporate(normalized: string): string {
  return normalized
    .split(' ')
    .filter((w) => w && !CORPORATE_WORDS.has(w))
    .join(' ');
}

/** Canonical brand string: normalized, corporate suffixes dropped, aliases applied. */
export function normalizeBrand(value: string): string {
  const stripped = dropCorporate(normalizeText(value));
  return BRAND_ALIASES[stripped] ?? stripped;
}

/** Model codes compare case-, dash- and space-insensitively: "Air 3" == "AIR3", "H-7130" == "h7130". */
export function normalizeModel(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Crude singularization so "heaters" matches "heater". */
function singular(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'for', 'with', 'and', 'my', 'our', 'old']);

/** Content words of a product description, singularized: "Personal Electric Space Heaters" -> heater, ... */
export function productTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(singular);
}

/** True if `phrase` appears in `haystack` as whole words (both already normalized). */
export function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}
