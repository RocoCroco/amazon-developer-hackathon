import { questionFor, type Clarification, type PeriodMiss } from './matcher/clarify.js';
import type { ConfirmedMatch } from './matcher/confirm.js';
import type { Item } from './matcher/match.js';

/** Spoken name of an item: "Govee H7131 space heater". Model codes are spaced out for speech. */
export function spokenItem(item: Item): string {
  const parts = [item.brand, item.model ? spokenModel(item.model) : undefined, item.name];
  return parts.filter(Boolean).join(' ');
}

/** "H7131" -> "H 7 1 3 1" so a text-to-speech voice reads the characters, not a word. */
export function spokenModel(model: string): string {
  return model
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/([A-Za-z])(?=\d)|(\d)(?=[A-Za-z0-9])/g, '$1$2 ')
    .replace(/\s+/g, ' ');
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
  const { question } = questionFor(best, matches);
  return `There is a recall for a similar item, and I need one more detail to be sure. ${question}`;
}

/** Nothing matched, but the brand is one or two keystrokes from a recalled brand. */
export function spokenBrandNotFound(item: Item, suggestion: Clarification): string {
  return `I could not find any recalls under the brand ${item.brand}. ${suggestion.question}`;
}

/** The recall exists for this brand and model, but not for the owner's year. */
export function spokenPeriodMiss(item: Item, miss: PeriodMiss): string {
  return `There is a recall for your ${spokenItem({ ...item, year: undefined })}, but only for items ${miss.period}. Yours is from ${item.year}, so it does not look affected. ${miss.clarification.question}`;
}
