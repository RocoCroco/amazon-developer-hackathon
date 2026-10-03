import { Hash } from '@smithy/hash-node';
import { SignatureV4 } from '@smithy/signature-v4';
import type { AwsCredentialIdentity, Provider } from '@smithy/types';

/**
 * Amazon Transcribe streaming for the simulator's microphone (T10.1). The browser opens the WebSocket itself;
 * the server only hands out a short-lived presigned URL, so no AWS credentials ever reach the page and the
 * audio never passes through our Lambda. Protocol: docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html
 */
export interface Transcriber {
  /** A wss:// URL valid for `expiresIn` seconds that starts one en-US streaming transcription. */
  presign(): Promise<{ url: string; expiresIn: number; sampleRate: number }>;
}

export interface TranscribeOptions {
  region?: string;
  /** Custom vocabulary built from the brands in our recall data (scripts/build-vocabulary.mjs). */
  vocabularyName?: string;
  credentials: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
  /** Seconds the URL stays valid (Transcribe allows at most 300). */
  expiresIn?: number;
  now?: () => Date;
}

export const SAMPLE_RATE = 16_000;

export class TranscribePresigner implements Transcriber {
  private readonly signer: SignatureV4;
  private readonly host: string;

  constructor(private readonly options: TranscribeOptions) {
    const region = options.region ?? 'us-east-1';
    this.host = `transcribestreaming.${region}.amazonaws.com:8443`;
    this.signer = new SignatureV4({
      service: 'transcribe',
      region,
      credentials: options.credentials,
      sha256: Hash.bind(null, 'sha256'),
    });
  }

  async presign(): Promise<{ url: string; expiresIn: number; sampleRate: number }> {
    const expiresIn = Math.min(this.options.expiresIn ?? 60, 300);
    const query: Record<string, string> = {
      // Always US English, whatever the browser or operating system language is.
      'language-code': 'en-US',
      'media-encoding': 'pcm',
      'sample-rate': String(SAMPLE_RATE),
      // Stable partial results: words stop changing sooner, so the live bubble flickers less.
      'enable-partial-results-stabilization': 'true',
      'partial-results-stability': 'medium',
      ...(this.options.vocabularyName ? { 'vocabulary-name': this.options.vocabularyName } : {}),
    };
    const signed = await this.signer.presign(
      {
        method: 'GET',
        protocol: 'wss:',
        hostname: this.host.split(':')[0]!,
        port: 8443,
        path: '/stream-transcription-websocket',
        headers: { host: this.host },
        query,
      },
      { expiresIn, signingDate: this.options.now?.() },
    );
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(signed.query ?? {})) {
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return {
      url: `wss://${this.host}${signed.path}?${params.toString()}`,
      expiresIn,
      sampleRate: SAMPLE_RATE,
    };
  }
}
