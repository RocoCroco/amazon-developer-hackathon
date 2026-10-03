import { questionFor, spokenList, type Clarification, type PeriodMiss } from './matcher/clarify.js';
import type { ConfirmedMatch } from './matcher/confirm.js';
import type { Item } from './matcher/match.js';

/**
 * Spoken name of an item: "Govee H7131 space heater". Model codes stay as written: the speech layer
 * (Amazon Polly SSML in the simulator) spells them out, so the written transcript stays readable.
 */
export function spokenItem(item: Item): string {
  return [item.brand, item.model, item.name].filter(Boolean).join(' ');
}

const COUNT_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Small counts as words, which a voice reads better than digits: 3 -> "three". */
export function spokenCount(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/** Capitalizes the first letter of a sentence built from spoken words ("one item" -> "One item"). */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a Govee heater", "an Evenflo seat". A simple vowel rule: good enough for product names. */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/** Product names often carry trademark symbols a voice would read out loud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u00AE\u2122\u00A9]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First sentence of a text, trimmed to a speakable length, with URLs removed. */
export function firstSentence(text: string, maxChars = 160): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? clean : clean.slice(0, end + 1);
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1).trimEnd()}.` : sentence;
}

/** Spoken one-liner for a check result. Never claims a match we are not sure about. */
export function spokenCheckSummary(item: Item, matches: ConfirmedMatch[]): string {
  const what = spokenItem(item);
  const best = matches[0];
  if (!best) {
    return `Good news: I found no recalls for your ${what}.`;
  }
  const hazard = firstSentence(best.recall.hazard || best.recall.title);
  if (best.level === 'strong') {
    return `Your ${what} is recalled. ${hazard}`;
  }
  const { question, options } = questionFor(best, matches);
  // Without a model we can only say that some of these are recalled; the model number is hard to find, so
  // say why it is worth looking for it. Short for the ear: the hazard comes once we know it is this one.
  if (best.missing.includes('model')) {
    if (options && options.length > 1) {
      return `Some ${what} models are recalled: ${spokenList(options)}. Is yours one of them? If you are not sure, the model number is usually on a sticker on the bottom or back.`;
    }
    return `Some ${what} models are recalled, so I need your model number. It is usually on a sticker on the bottom or back.`;
  }
  return `There may be a recall for your ${what}, and I need one more detail to be sure. ${question}`;
}

/** Nothing matched, but the brand is one or two keystrokes from a recalled brand. */
export function spokenBrandNotFound(item: Item, suggestion: Clarification): string {
  return `I could not find any recalls under the brand ${item.brand}. ${suggestion.question}`;
}

/** The recall exists for this brand and model, but not for the owner's year. */
export function spokenPeriodMiss(item: Item, miss: PeriodMiss): string {
  return `There is a recall for your ${spokenItem({ ...item, year: undefined })}, but only for items ${miss.period}. Yours is from ${item.year}, so it does not look affected. ${miss.clarification.question}`;
}

/** "I couldn't reach the CPSC recall database just now, so I can't confirm ... yet." */
export function spokenSourcesDown(item: Item, sources: string[], saved: boolean): string {
  const which =
    sources.length === 1 ? `the ${sources[0]} recall database` : 'some recall databases';
  const later = saved
    ? " I'll check it again in the daily scan."
    : ' Please ask me again in a little while.';
  return `I couldn't reach ${which} just now, so I can't confirm that your ${spokenItem(item)} is clear yet.${later}`;
}
