import { createHash } from 'node:crypto';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

/** What the browser plays. */
export interface Speech {
  audio: Uint8Array;
  contentType: string;
}

export interface Speaker {
  synthesize(text: string): Promise<Speech>;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A model code mixes UPPERCASE letters and digits ("H7131", "LTD-SM23", "KCVQ08B10A", "ZX-100"). A voice
 * would read it as a word or a huge number, so it is spelled out character by character. Names with a
 * lowercase letter ("Extend2Fit", "SnugRide35") are product names and are read normally.
 */
const CODE =
  /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])(?![A-Za-z0-9-]*[a-z])[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;

/** Words that contain a digit but are ordinary: "2nd", "3rd", "10th"... */
const ORDINAL = /^\d+(st|nd|rd|th)$/i;

/** Plain reply text -> SSML for Polly: escape markup, spell out model codes, short pauses between sentences. */
export function toSsml(text: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    const code = m[0];
    if (ORDINAL.test(code)) continue;
    parts.push(escapeXml(text.slice(last, m.index)));
    const spelled = code.replace(/-/g, '');
    parts.push(`<say-as interpret-as="characters">${escapeXml(spelled)}</say-as>`);
    last = m.index + code.length;
  }
  parts.push(escapeXml(text.slice(last)));
  return `<speak>${parts.join('').replace(/\s+/g, ' ').trim()}</speak>`;
}

/** Keeps a spoken reply short: at most `max` characters, cut at a sentence end where possible. */
export function clipForSpeech(text: string, max = 600): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}.`;
}

/** Amazon Polly, neural voice, MP3, with an in-memory cache so repeated phrases cost nothing. */
export class PollySpeaker implements Speaker {
  private readonly cache = new Map<string, Speech>();

  constructor(
    private readonly voiceId = process.env.POLLY_VOICE_ID ?? 'Joanna',
    private readonly client = new PollyClient({ region: 'us-east-1' }),
    private readonly maxEntries = 200,
  ) {}

  async synthesize(text: string): Promise<Speech> {
    const ssml = toSsml(clipForSpeech(text));
    const key = createHash('sha256').update(`${this.voiceId}|${ssml}`).digest('hex');
    const hit = this.cache.get(key);
    if (hit) return hit;

    const res = await this.client.send(
      new SynthesizeSpeechCommand({
        Engine: 'neural',
        VoiceId: this.voiceId as never,
        OutputFormat: 'mp3',
        TextType: 'ssml',
        Text: ssml,
      }),
    );
    if (!res.AudioStream) throw new Error('Polly returned no audio');
    const speech: Speech = {
      audio: await res.AudioStream.transformToByteArray(),
      contentType: res.ContentType ?? 'audio/mpeg',
    };
    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, speech);
    return speech;
  }
}

/**
 * Spending guard for the public demo: each session may speak only so many characters, and the whole
 * process only so many per day. Polly neural is $16 per million characters (docs/costs.md).
 */
export class SpeechBudget {
  private readonly perSession = new Map<string, number>();
  private day = '';
  private today = 0;

  constructor(
    private readonly sessionChars = 6_000,
    private readonly dailyChars = 120_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Records the use if it fits, and says whether it did. */
  tryUse(sessionId: string, chars: number): boolean {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.today = 0;
    }
    const used = this.perSession.get(sessionId) ?? 0;
    if (used + chars > this.sessionChars || this.today + chars > this.dailyChars) return false;
    this.perSession.set(sessionId, used + chars);
    this.today += chars;
    return true;
  }
}
