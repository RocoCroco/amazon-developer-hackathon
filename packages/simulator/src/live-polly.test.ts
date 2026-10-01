import { describe, expect, it } from 'vitest';
import { PollySpeaker } from './speech.js';

/** Real Amazon Polly (neural). Run with: npm run test:live */
describe.skipIf(!process.env.LIVE)('live Polly', () => {
  it('speaks a reply with a spelled-out model code as MP3', async () => {
    const speech = await new PollySpeaker().synthesize(
      'Your Govee H7131 space heater is recalled. Stop using it now.',
    );
    expect(speech.contentType).toBe('audio/mpeg');
    expect(speech.audio.length).toBeGreaterThan(5000);
    console.log(`POLLY ${speech.audio.length} bytes`);
  }, 60_000);
});
