import type { Alert } from './alerts.js';
import { firstSentence } from './voice.js';

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const URL_RE = /https?:\/\/[^\s)"]+/;
/** Wording that means "stop using it now". */
const STOP =
  /\b(stop using|do not use|discontinue use|immediately stop|should not be used|do not drive|do not eat|do not consume|do not give|stop driving|stop wearing)\b/i;

export interface Remedy {
  /** Short steps in the order to do them, as plain sentences with no links. */
  steps: string[];
  /** One or two sentences to say aloud. */
  spoken: string;
  /** Free repair, replacement or refund, as the source states. */
  options: string[];
  /** Phone number to call, in the form it was published. */
  phone?: string;
  /** Link for the screen; never read aloud. */
  web?: string;
  /** True when the recall text tells owners to stop using the product. */
  stopUsing: boolean;
}

/** "833-772-5360" -> "8 3 3, 7 7 2, 5 3 6 0" so a voice reads digits, not a big number. */
export function spokenPhone(phone: string): string {
  const groups = phone.replace(/^\+?1[\s.-]?/, '').match(/\d+/g) ?? [];
  return groups.map((g) => g.split('').join(' ')).join(', ');
}

/** Words that already name the fix, so repeating the options would be noise. */
const FIX_WORDS = /\b(refund|replace|replacement|repair|reimburs)/i;

const OPTION_WORDS: Record<string, string> = {
  repair: 'a free repair',
  replace: 'a free replacement',
  refund: 'a refund',
};

/** Step-by-step remedy for an alert, built only from what the recall says. */
export function buildRemedy(alert: Alert): Remedy {
  const r = alert.recall;
  const stopUsing = STOP.test(`${r.remedy} ${r.hazard}`);
  const phone = PHONE.exec(r.contact)?.[0] ?? PHONE.exec(r.remedy)?.[0];
  const web = (URL_RE.exec(r.contact) ?? URL_RE.exec(r.remedy) ?? URL_RE.exec(r.url))?.[0];
  const options = r.remedyOptions.filter((o) => OPTION_WORDS[o]).map((o) => OPTION_WORDS[o]!);

  const action = firstSentence(r.remedy, 220);
  const steps: string[] = [];
  // Say "stop using it" once: skip our generic line when the recall's own first sentence already says it.
  if (stopUsing && !STOP.test(action)) steps.push('Stop using it now.');
  if (action) steps.push(action);
  // Skip the options line when the action already names the fix ("... contact the firm for a refund").
  if (options.length && !FIX_WORDS.test(action)) {
    steps.push(`The company offers ${options.join(' or ')}.`);
  }
  if (phone) steps.push(`You can call ${spokenPhone(phone)}.`);
  const webStep = web ? 'The recall page is on your screen.' : undefined;
  if (webStep) steps.push(webStep);

  // Spoken: the first three steps, never the on-screen link.
  const spokenSteps = steps.filter((s) => s !== webStep).slice(0, 3);
  const spoken = spokenSteps.length
    ? spokenSteps.join(' ')
    : 'I could not find fix instructions in the recall notice.';
  return { steps, spoken, options, phone, web, stopUsing };
}
