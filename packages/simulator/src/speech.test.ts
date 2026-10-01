import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { mockClient } from 'aws-sdk-client-mock';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import { clipForSpeech, PollySpeaker, SpeechBudget, toSsml } from './speech.js';

describe('toSsml', () => {
  it('spells out model codes character by character', () => {
    expect(toSsml('Your Govee H7131 space heater is recalled.')).toBe(
      '<speak>Your Govee <say-as interpret-as="characters">H7131</say-as> space heater is recalled.</speak>',
    );
    expect(toSsml('Model KCVQ08B10A.')).toContain('>KCVQ08B10A</say-as>');
  });

  it('drops hyphens inside a spelled code', () => {
    expect(toSsml('The LTD-SM23 and the ZX-100.')).toBe(
      '<speak>The <say-as interpret-as="characters">LTDSM23</say-as> and the <say-as interpret-as="characters">ZX100</say-as>.</speak>',
    );
  });

  it('leaves ordinary words, years, numbers and product names alone', () => {
    for (const text of [
      'Made between July 2010 and May 2013.',
      'You have three items.',
      'Call 8 3 3, 7 7 2, 5 3 6 0.',
      'Your Graco Extend2Fit car seat.',
      'The SnugRide35 and the B-Agile.',
      'Your 2nd car seat and the 22-371 model.',
    ]) {
      expect(toSsml(text)).toBe(`<speak>${text}</speak>`);
    }
  });

  it('escapes markup so a reply can never inject SSML', () => {
    expect(toSsml('Fish & chips <break time="9s"/> "quoted"')).toBe(
      '<speak>Fish &amp; chips &lt;break time=&quot;9s&quot;/&gt; &quot;quoted&quot;</speak>',
    );
  });

  it('collapses whitespace', () => {
    expect(toSsml('  Hello \n\n  there.  ')).toBe('<speak>Hello there.</speak>');
  });
});

describe('clipForSpeech', () => {
  it('keeps short text and cuts long text at a sentence end', () => {
    expect(clipForSpeech('Short one.')).toBe('Short one.');
    const long = `${'First sentence here. '.repeat(10)}${'x'.repeat(500)}`;
    const clipped = clipForSpeech(long, 120);
    expect(clipped.length).toBeLessThanOrEqual(120);
    expect(clipped.endsWith('.')).toBe(true);
  });
});

describe('PollySpeaker', () => {
  const polly = mockClient(PollyClient);
  const audio = Uint8Array.from([1, 2, 3, 4]);
  const reply = () => ({
    AudioStream: sdkStreamMixin(Readable.from([Buffer.from(audio)])),
    ContentType: 'audio/mpeg',
  });

  beforeEach(() => {
    polly.reset();
    polly.on(SynthesizeSpeechCommand).callsFake(reply);
  });

  it('asks Polly for a neural MP3 voice with SSML and returns the audio', async () => {
    const speaker = new PollySpeaker('Joanna', new PollyClient({ region: 'us-east-1' }));
    const speech = await speaker.synthesize('Your Govee H7131 heater is recalled.');
    expect([...speech.audio]).toEqual([1, 2, 3, 4]);
    expect(speech.contentType).toBe('audio/mpeg');
    expect(polly.commandCalls(SynthesizeSpeechCommand)[0]!.args[0].input).toMatchObject({
      Engine: 'neural',
      VoiceId: 'Joanna',
      OutputFormat: 'mp3',
      TextType: 'ssml',
    });
  });

  it('answers a repeated phrase from the cache', async () => {
    const speaker = new PollySpeaker('Joanna', new PollyClient({ region: 'us-east-1' }));
    await speaker.synthesize('Hello there.');
    await speaker.synthesize('  Hello   there. ');
    expect(polly.commandCalls(SynthesizeSpeechCommand)).toHaveLength(1);
    await speaker.synthesize('Something else.');
    expect(polly.commandCalls(SynthesizeSpeechCommand)).toHaveLength(2);
  });

  it('evicts the oldest entry when the cache is full', async () => {
    const speaker = new PollySpeaker('Joanna', new PollyClient({ region: 'us-east-1' }), 2);
    for (const t of ['One.', 'Two.', 'Three.']) await speaker.synthesize(t);
    await speaker.synthesize('One.'); // evicted, so asked again
    expect(polly.commandCalls(SynthesizeSpeechCommand)).toHaveLength(4);
  });

  it('fails clearly when Polly sends no audio', async () => {
    polly.reset();
    polly.on(SynthesizeSpeechCommand).resolves({});
    await expect(
      new PollySpeaker('Joanna', new PollyClient({ region: 'us-east-1' })).synthesize('Hi.'),
    ).rejects.toThrow(/no audio/);
  });
});

describe('SpeechBudget', () => {
  it('limits characters per session', () => {
    const budget = new SpeechBudget(100, 10_000);
    expect(budget.tryUse('a', 60)).toBe(true);
    expect(budget.tryUse('a', 60)).toBe(false);
    expect(budget.tryUse('b', 60)).toBe(true); // another session is unaffected
  });

  it('limits characters per day, and starts again the next day', () => {
    let now = new Date('2026-10-01T10:00:00Z');
    const budget = new SpeechBudget(1_000, 150, () => now);
    expect(budget.tryUse('a', 100)).toBe(true);
    expect(budget.tryUse('b', 100)).toBe(false);
    now = new Date('2026-10-02T10:00:00Z');
    expect(budget.tryUse('b', 100)).toBe(true);
  });

  it('does not charge for a request that was refused', () => {
    const budget = new SpeechBudget(100, 10_000);
    expect(budget.tryUse('a', 150)).toBe(false);
    expect(budget.tryUse('a', 100)).toBe(true);
  });
});
