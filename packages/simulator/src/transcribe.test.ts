import { describe, expect, it } from 'vitest';
import {
  crc32,
  decodeMessage,
  encodeAudioEvent,
  encodeMessage,
  readTranscribeMessage,
} from '../public/eventstream.js';
import { TranscribePresigner } from './transcribe.js';

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const text = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

// An example frame printed in the Amazon Transcribe developer guide ("Setting up a streaming transcription").
// (Its audio-event example is garbled, see FRICTION_LOG F20, so it is not used.)
const DOC_SIGNED_FRAME = b64(
  'AAAAUwAAAEP1RHpYBTpkYXRlCAAAAWiXUkMLEDpjaHVuay1zaWduYXR1cmUGACCt6Zy+uymwEK2SrLp/zVBI5eGn83jdBwCaRUBJA+eaDafqjqI=',
);

describe('event stream encoding (the WebSocket framing of Transcribe streaming)', () => {
  it('computes the gzip CRC32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926); // the standard check value
  });

  it('decodes the example from the AWS documentation, checksums and all header types included', () => {
    const signed = decodeMessage(DOC_SIGNED_FRAME);
    expect(Object.keys(signed.headers).sort()).toEqual([':chunk-signature', ':date']);
    expect((signed.headers[':chunk-signature'] as Uint8Array).length).toBe(32);
  });

  it('round-trips its own messages and matches what the decoder expects', () => {
    const headers = { ':event-type': 'AudioEvent', ':message-type': 'event' };
    const message = encodeMessage(headers, text('RIFF'));
    expect(decodeMessage(message).headers).toEqual(headers);
    expect(Buffer.from(decodeMessage(message).payload).toString()).toBe('RIFF');
  });

  it('frames microphone audio as an AudioEvent, and an empty one ends the stream', () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 255, 127]);
    const decoded = decodeMessage(encodeAudioEvent(pcm));
    expect(decoded.headers).toEqual({
      ':content-type': 'application/octet-stream',
      ':event-type': 'AudioEvent',
      ':message-type': 'event',
    });
    expect([...decoded.payload]).toEqual([...pcm]);
    expect(decodeMessage(encodeAudioEvent(new Uint8Array())).payload.length).toBe(0);
  });

  it('rejects a corrupted message', () => {
    const broken = new Uint8Array(DOC_SIGNED_FRAME);
    broken[40] = broken[40]! ^ 0xff;
    expect(() => decodeMessage(broken)).toThrow(/CRC/);
  });

  it('assembles transcripts across partial and final results, and surfaces exceptions', () => {
    const event = (results: unknown[]) =>
      encodeMessage(
        {
          ':event-type': 'TranscriptEvent',
          ':message-type': 'event',
          ':content-type': 'application/json',
        },
        text(JSON.stringify({ Transcript: { Results: results } })),
      );
    const results = new Map<string, string>();
    const r = (id: string, t: string, partial: boolean) => ({
      ResultId: id,
      IsPartial: partial,
      Alternatives: [{ Transcript: t }],
    });
    expect(readTranscribeMessage(event([r('a', 'Alexa we got', true)]), results).text).toBe(
      'Alexa we got',
    );
    expect(
      readTranscribeMessage(event([r('a', 'Alexa, we got an Aitjunz dresser.', false)]), results)
        .text,
    ).toBe('Alexa, we got an Aitjunz dresser.');
    expect(readTranscribeMessage(event([r('b', 'Model', true)]), results).text).toBe(
      'Alexa, we got an Aitjunz dresser. Model',
    );
    const failure = encodeMessage(
      { ':message-type': 'exception', ':exception-type': 'BadRequestException' },
      text('{"Message":"bad"}'),
    );
    expect(readTranscribeMessage(failure, results).error).toMatch(/BadRequestException/);
  });
});

describe('TranscribePresigner', () => {
  const presigner = new TranscribePresigner({
    credentials: {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'tok+en/=',
    },
    vocabularyName: 'recall-guardian-brands',
    now: () => new Date('2026-10-03T12:00:00Z'),
  });

  it('signs a short-lived en-US WebSocket URL with the documented query parameters', async () => {
    const { url, expiresIn, sampleRate } = await presigner.presign();
    const u = new URL(url);
    expect(u.protocol).toBe('wss:');
    expect(u.host).toBe('transcribestreaming.us-east-1.amazonaws.com:8443');
    expect(u.pathname).toBe('/stream-transcription-websocket');
    const q = Object.fromEntries(u.searchParams);
    expect(q).toMatchObject({
      'language-code': 'en-US',
      'media-encoding': 'pcm',
      'sample-rate': '16000',
      'vocabulary-name': 'recall-guardian-brands',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'AKIDEXAMPLE/20261003/us-east-1/transcribe/aws4_request',
      'X-Amz-Date': '20261003T120000Z',
      'X-Amz-Expires': '60',
      'X-Amz-SignedHeaders': 'host',
      'X-Amz-Security-Token': 'tok+en/=',
    });
    expect(q['X-Amz-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresIn).toBe(60);
    expect(sampleRate).toBe(16_000);
  });
});
