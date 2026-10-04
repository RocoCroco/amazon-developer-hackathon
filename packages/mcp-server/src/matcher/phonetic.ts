/**
 * Sound-alike matching for brand names heard by speech recognition.
 *
 * Speech recognizers turn unusual brand names into common words: "Aitjunz" comes back as "iTunes",
 * "8th June" or "eight junes". Spelling-based edit distance cannot see that these sound alike, so brands are
 * compared on a rough English pronunciation key as well. This runs in the MCP server, so it helps any voice
 * client (the simulator and a real Alexa+ alike).
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const ORDINALS: Record<string, string> = {
  '1st': 'first',
  '2nd': 'second',
  '3rd': 'third',
  '4th': 'fourth',
  '5th': 'fifth',
  '6th': 'sixth',
  '7th': 'seventh',
  '8th': 'eighth',
  '9th': 'ninth',
};

/** "8th June" -> "eighth june", "4kids" -> "four kids": recognizers write numbers as digits. */
function numbersToWords(text: string): string {
  return text
    .replace(/\b([1-9])(st|nd|rd|th)\b/gi, (m) => ORDINALS[m.toLowerCase()] ?? m)
    .replace(/\d/g, (d) => ` ${ONES[Number(d)]} `);
}

/**
 * "A I T J U N Z", "a-i-t-j-u-n-z" or "A. I. T." -> "AITJUNZ": a brand spelled letter by letter.
 * Anything else comes back unchanged.
 */
export function unspell(value: string): string {
  const trimmed = value.trim();
  if (/^(?:[a-z0-9]\.?[\s.,-]+){2,}[a-z0-9]\.?$/i.test(trimmed)) {
    return trimmed.replace(/[^a-z0-9]/gi, '').toUpperCase();
  }
  return value;
}

// Words that describe a product rather than say who makes it.
const DESCRIPTOR_WORDS = new Set(
  (
    'one two three four five six seven eight nine ten eleven twelve ' +
    'drawer door shelf shelve tier piece seat seater inch in ft foot feet gallon quart cup liter litre oz lb ' +
    'pack count set pair compartment burner speed slot layer level step person wheel way ' +
    'white black gray grey brown blue red green pink beige cream natural yellow purple silver gold ' +
    'wooden wood metal plastic glass steel bamboo oak pine walnut fabric leather ' +
    'small large mini big tall short double twin full queen king compact portable new used old second hand electric'
  ).split(' '),
);

/**
 * "eight-drawer", "6 drawer", "white", "wooden": a description, not a brand. The assistant sometimes reads
 * "an eight-drawer dresser" as brand + product; the server then asks who makes it instead.
 */
export function isDescriptiveBrand(brand: string): boolean {
  const words = brand
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
  return (
    words.length > 0 &&
    words.every(
      (w) =>
        /^\d+$/.test(w) || DESCRIPTOR_WORDS.has(w) || DESCRIPTOR_WORDS.has(w.replace(/s$/, '')),
    )
  );
}

/**
 * Item fields as the server keeps them: a brand spelled letter by letter is joined ("A I T J U N Z" -> AITJUNZ),
 * and a descriptive "brand" moves back into the name ("eight-drawer" + "dresser" -> "eight-drawer dresser").
 */
export function cleanBrandField<T extends { brand?: string; name?: string }>(fields: T): T {
  if (!fields.brand) return fields;
  const brand = unspell(fields.brand);
  if (!isDescriptiveBrand(brand)) return { ...fields, brand };
  const rest: Omit<T, 'brand'> & { brand?: string } = { ...fields };
  delete rest.brand;
  const name =
    rest.name && !rest.name.toLowerCase().includes(brand.toLowerCase())
      ? `${brand} ${rest.name}`
      : rest.name;
  return { ...rest, ...(name ? { name } : {}) } as T;
}

/** "Aitjunz" -> "A-I-T-J-U-N-Z", for Alexa to read a brand back letter by letter. */
export function spellOut(brand: string): string {
  return brand
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .split('')
    .join('-');
}

// Ordered rewrite rules from spelling to a rough sound. Vowels stay (as one of a, e, i, o, u), consonants
// that sound alike collapse into one letter: j for the "ch / j / soft g" family, s for "s / z / soft c".
const RULES: [RegExp, string][] = [
  [/eigh/g, 'a'],
  [/aigh/g, 'a'],
  [/igh/g, 'i'],
  [/ough/g, 'o'],
  [/gh/g, 'g'],
  [/ph/g, 'f'],
  [/ck/g, 'k'],
  [/qu/g, 'kw'],
  [/x/g, 'ks'],
  [/tch/g, 'j'],
  [/(?:ch|sh|dg|dj)/g, 'j'],
  [/th/g, 't'],
  [/wh/g, 'w'],
  [/c(?=[eiy])/g, 's'],
  [/c/g, 'k'],
  [/g(?=[eiy])/g, 'j'],
  [/z/g, 's'],
  [/(?:ai|ay|ei|ey)/g, 'a'],
  [/(?:ee|ea|ie)/g, 'i'],
  [/(?:oo|ou|ew)/g, 'u'],
  [/y(?=[aeiou])/g, ''],
  [/y/g, 'i'],
  [/es$/g, 's'],
  [/(?<=[^aeiou])e$/g, ''],
  [/([a-z])\1+/g, '$1'],
];

/** A rough pronunciation key: "Aitjunz" -> "atjuns", "8th June" -> "atjun", "iTunes" -> "ituns". */
export function soundKey(value: string): string {
  let key = numbersToWords(value)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  for (const [pattern, replacement] of RULES) key = key.replace(pattern, replacement);
  return key;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const NEAR = [
  ['t', 'd'],
  ['s', 'j'],
  ['b', 'p'],
  ['k', 'g'],
  ['f', 'v'],
  ['m', 'n'],
  ['w', 'v'],
  ['l', 'r'],
];
const isNear = (a: string, b: string) =>
  NEAR.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/** Edit cost between two sounds: vowels are cheap to confuse, similar consonants a bit dearer, others 1. */
function substitution(a: string, b: string): number {
  if (a === b) return 0;
  if (VOWELS.has(a) && VOWELS.has(b)) return 0.4;
  if (isNear(a, b)) return 0.5;
  return 1;
}
const indel = (c: string) => (VOWELS.has(c) ? 0.5 : 1);

/** Weighted edit distance between two sound keys. */
export function soundDistance(a: string, b: string): number {
  const row = [0];
  for (let j = 1; j <= b.length; j++) row[j] = row[j - 1]! + indel(b[j - 1]!);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = diagonal + indel(a[i - 1]!);
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(
        above + indel(a[i - 1]!),
        row[j - 1]! + indel(b[j - 1]!),
        diagonal + substitution(a[i - 1]!, b[j - 1]!),
      );
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * How different two brand names SOUND, 0 (same) to about 1 (unrelated), relative to their length.
 * "iTunes" vs "Aitjunz" is about 0.23; "8th June" vs "Aitjunz" about 0.17; "Graco" vs "Evenflo" about 0.8.
 */
export function soundDifference(heard: string, brand: string): number {
  const a = soundKey(heard);
  const b = soundKey(brand);
  if (!a || !b) return 1;
  return soundDistance(a, b) / Math.max(a.length, b.length);
}
