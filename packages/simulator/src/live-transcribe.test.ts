import { execFileSync } from 'node:child_process';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { describe, expect, it } from 'vitest';
import { encodeAudioEvent, readTranscribeMessage } from '../public/eventstream.js';
import { TranscribePresigner } from './transcribe.js';

/**
 * Real Amazon Transcribe over WebSocket, exactly as the page does it: presigned URL from our signer, audio
 * framed by our event stream codec. The audio is Polly reading a sentence as 16 kHz PCM.
 * Run with: npm run test:live (uses the local AWS profile; costs a fraction of a cent).
 */
async function pollyPcm(text: string): Promise<Uint8Array> {
  const res = await new PollyClient({ region: 'us-east-1' }).send(
    new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'pcm',
      SampleRate: '16000',
      VoiceId: 'Joanna',
      Engine: 'neural',
    }),
  );
  return res.AudioStream!.transformToByteArray();
}

async function transcribe(url: string, pcm: Uint8Array): Promise<string> {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const results = new Map<string, string>();
  let text = '';
  const done = new Promise<string>((resolve, reject) => {
    socket.onmessage = (event) => {
      const message = readTranscribeMessage(event.data as ArrayBuffer, results);
      if (message.error) reject(new Error(message.error));
      if (message.text !== undefined) text = message.text;
    };
    socket.onerror = () => reject(new Error('WebSocket error'));
    socket.onclose = () => resolve(text);
  });
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    setTimeout(() => reject(new Error('WebSocket did not open')), 10_000);
  });
  // 100 ms chunks at twice real time, then 1 s of silence and the empty event that ends the stream.
  const chunk = 3_200;
  for (let i = 0; i < pcm.length; i += chunk) {
    socket.send(encodeAudioEvent(pcm.subarray(i, i + chunk)));
    await new Promise((r) => setTimeout(r, 50));
  }
  socket.send(encodeAudioEvent(new Uint8Array(32_000)));
  socket.send(encodeAudioEvent(new Uint8Array()));
  return done;
}

describe.skipIf(!process.env.LIVE)('live Amazon Transcribe streaming', () => {
  it('transcribes speech streamed through our presigned URL and event stream codec', async () => {
    const vocabularyName = process.env.TRANSCRIBE_VOCABULARY;
    const presigner = new TranscribePresigner({ credentials: defaultProvider(), vocabularyName });
    const { url } = await presigner.presign();
    const heard = await transcribe(
      url,
      await pollyPcm('Alexa, we were gifted an eight drawer dresser and a Chicco car seat.'),
    );
    console.log(`TRANSCRIBE (vocabulary ${vocabularyName ?? 'none'}): ${heard}`);
    expect(heard.toLowerCase()).toMatch(/alexa/);
    expect(heard.toLowerCase()).toMatch(/dresser/);
    expect(heard.toLowerCase()).toMatch(/car seat/);
  }, 60_000);

  it('works with a URL signed by the deployed simulator (its IAM role and the custom vocabulary)', async () => {
    const simulator = execFileSync(
      'aws',
      [
        'cloudformation',
        'describe-stacks',
        '--stack-name',
        'RecallGuardianStack',
        '--region',
        'us-east-1',
        '--query',
        "Stacks[0].Outputs[?OutputKey=='SimulatorUrl'].OutputValue",
        '--output',
        'text',
      ],
      { encoding: 'utf8' },
    ).trim();
    const res = await fetch(`${simulator}api/transcribe`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).searchParams.get('vocabulary-name')).toBe('recall-guardian-brands');
    const heard = await transcribe(
      url,
      await pollyPcm('We got a Graco car seat and an Evenflo stroller.'),
    );
    console.log(`TRANSCRIBE (deployed signer): ${heard}`);
    expect(heard.toLowerCase()).toMatch(/car seat/);
  }, 60_000);
});
