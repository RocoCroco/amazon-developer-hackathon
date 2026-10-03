/**
 * An Amazon Transcribe custom vocabulary from the brand names in our recall data (T10.1), so the microphone
 * hears "Chicco" instead of "Kiko" and "Aitjunz" instead of "8th June".
 *
 * Table format (the list format is being deprecated): Phrase, SoundsLike, IPA, DisplayAs, tab separated.
 * Phrase rules (docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary-create-table.html): no spaces
 * (words joined by hyphens), no digits, en-US letters plus apostrophe, hyphen and period, periods only for
 * acronyms ("L.G."), not starting with . ' - nor ending with ' -, no repeated -- '' ... At most 50 KB.
 */

export const HEADER = 'Phrase\tSoundsLike\tIPA\tDisplayAs';
export const MAX_BYTES = 50 * 1024;

// Company words that are not part of what people say ("Graco Children's Products Inc." -> Graco).
const COMPANY_WORDS =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|gmbh|plc|lp|llp|usa|us|international|group|holdings?|enterprises?|industries|brands|products|trading|technology|technologies|e-?commerce|manufacturing|mfg|imports?|distribution|distributors?|america|north|na|of)\b\.?/gi;

// Single words too common to bias the recognizer towards.
const TOO_COMMON = new Set(
  (
    'the and home baby kids child children toys toy furniture model accessory accessories series ' +
    'new best great little big smart pro plus max mini one first light lights power basic select ' +
    'car cars bicycle bicycles bike utility vehicle vehicles unknown various generic ' +
    'dresser chair table bed seat heater stroller crib lamp'
  ).split(' '),
);

export interface VocabularyEntry {
  phrase: string;
  displayAs: string;
}

/** "Graco Children's Products Inc." -> { phrase: "Graco", displayAs: "Graco" }; undefined when unusable. */
export function vocabularyEntry(brand: string): VocabularyEntry | undefined {
  // "Shenzhen X Co., Ltd., d/b/a NEWDERY" -> the trade name
  const dba = /\b(?:d\/b\/a|dba)\s+([^,]+)/i.exec(brand)?.[1] ?? brand;
  // "Target, Minneapolis, Minn." -> "Target": the brand comes before the first comma, a place may follow.
  const name = dba.split(',')[0] ?? '';
  if (/^\s*(made|manufactured|distributed|sold|imported)\b/i.test(name)) return undefined;
  const cleaned = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(COMPANY_WORDS, ' ')
    .replace(/[,;:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /[0-9]/.test(cleaned) || /[^A-Za-z' .-]/.test(cleaned)) return undefined;

  const words = cleaned
    .split(/[\s-]+/)
    .map((w) => w.replace(/\./g, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean);
  if (words.length === 0 || words.length > 3) return undefined;
  if (words.length === 1 && (words[0]!.length < 3 || TOO_COMMON.has(words[0]!.toLowerCase()))) {
    return undefined;
  }
  // An all-capital word without vowels is spelled out ("LG" -> "L.G.").
  const spoken = words.map((w) =>
    /^[A-Z]{2,4}$/.test(w) && !/[AEIOU]/.test(w) ? `${w.split('').join('.')}.` : w,
  );
  const phrase = spoken.join('-');
  if (/--|''|\.\./.test(phrase) || /^[.'-]|['-]$/.test(phrase)) return undefined;
  return { phrase, displayAs: words.join(' ') };
}

/**
 * The vocabulary file: the brands that must be there first (the demo's and the most common baby-gear
 * brands), then the others by how many recalls name them, until the 50 KB limit.
 */
export function buildVocabulary(
  brandCounts: Map<string, number>,
  mustInclude: string[] = [],
  maxBytes = MAX_BYTES - 1024,
): { text: string; entries: number } {
  const ranked = [
    ...mustInclude,
    ...[...brandCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([brand]) => brand),
  ];
  const seen = new Set<string>();
  const lines = [HEADER];
  let bytes = Buffer.byteLength(`${HEADER}\n`);
  for (const brand of ranked) {
    const entry = vocabularyEntry(brand);
    if (!entry || seen.has(entry.phrase.toLowerCase())) continue;
    const line = `${entry.phrase}\t\t\t${entry.displayAs}`;
    const size = Buffer.byteLength(`${line}\n`);
    if (bytes + size > maxBytes) break;
    seen.add(entry.phrase.toLowerCase());
    lines.push(line);
    bytes += size;
  }
  return { text: `${lines.join('\n')}\n`, entries: lines.length - 1 };
}
