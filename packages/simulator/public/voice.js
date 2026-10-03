// Speech recognition engines for the simulator (T10.1). Both report the running transcript of one stretch of
// listening through the same callbacks, so the conversation logic in app.js does not care which one runs:
//   start({ onText(text), onEnd(), onError(message) }), stop() to finish, abort() to drop.
// - TranscribeEngine: the microphone streamed to Amazon Transcribe (en-US, custom vocabulary of recall brands)
//   over a WebSocket presigned by our server. Better with accents; costs about a cent a minute.
// - BrowserEngine: the browser's own recognizer (Chrome, Edge), always set to en-US, free.
import { encodeAudioEvent, readTranscribeMessage } from './eventstream.js';

export const LANGUAGE = 'en-US';
const TARGET_RATE = 16_000;
const PREROLL_SECONDS = 3;
const CHUNK_BYTES = 3_200; // 100 ms of 16 kHz, 16-bit audio
/** One stream never runs longer than this (cost guard; a request is a sentence or two). */
const MAX_STREAM_MS = 45_000;

const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = []; this.size = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this.buffer.push(channel.slice(0));
      this.size += channel.length;
      if (this.size >= 2048) {
        const out = new Float32Array(this.size);
        let offset = 0;
        for (const part of this.buffer) { out.set(part, offset); offset += part.length; }
        this.port.postMessage(out, [out.buffer]);
        this.buffer = [];
        this.size = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

/** Float32 samples at `rate` -> 16 kHz, 16-bit little-endian PCM bytes. */
export function toPcm16k(samples, rate) {
  const ratio = rate / TARGET_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new DataView(new ArrayBuffer(length * 2));
  for (let i = 0; i < length; i++) {
    // average the source samples this output sample covers (a simple low-pass before decimating)
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < samples.length; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    out.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

/**
 * The microphone as 16 kHz PCM, opened once and shared. It keeps the last few seconds, so a request that
 * starts in the same breath as "Alexa" is not lost while the stream to Transcribe opens.
 */
export class Microphone {
  constructor() {
    this.context = null;
    this.stream = null;
    this.recent = [];
    this.recentBytes = 0;
    this.listeners = new Set();
  }

  get open() {
    return this.context !== null;
  }

  async openMic() {
    if (this.context) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const context = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await context.audioWorklet.addModule(url);
    const source = context.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(context, 'pcm-tap');
    // A silent path to the speakers keeps the graph running in every browser.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(tap);
    tap.connect(mute);
    mute.connect(context.destination);
    tap.port.onmessage = (event) => this.frame(toPcm16k(event.data, context.sampleRate));
    this.context = context;
  }

  frame(pcm) {
    this.recent.push(pcm);
    this.recentBytes += pcm.length;
    while (this.recentBytes > PREROLL_SECONDS * TARGET_RATE * 2 && this.recent.length > 1) {
      this.recentBytes -= this.recent.shift().length;
    }
    for (const listener of this.listeners) listener(pcm);
  }

  /** The last few seconds, oldest first. */
  preroll() {
    return [...this.recent];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.context = null;
    this.stream = null;
    this.recent = [];
    this.recentBytes = 0;
  }
}

/** Amazon Transcribe streaming, with a URL presigned by our server for each stretch of listening. */
export class TranscribeEngine {
  constructor(microphone, presign) {
    this.microphone = microphone;
    this.presign = presign; // async () => ({ url })
    this.socket = null;
    this.unsubscribe = null;
    this.timer = 0;
    this.ended = true;
  }

  async start({ onText, onEnd, onError, preroll = false }) {
    this.ended = false;
    await this.microphone.openMic();
    const { url } = await this.presign();
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const results = new Map();
    let pending = [];
    let pendingBytes = 0;
    const flush = () => {
      if (!pendingBytes || socket.readyState !== WebSocket.OPEN) return;
      const chunk = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const part of pending) {
        chunk.set(part, offset);
        offset += part.length;
      }
      socket.send(encodeAudioEvent(chunk));
      pending = [];
      pendingBytes = 0;
    };
    const queue = (pcm) => {
      pending.push(pcm);
      pendingBytes += pcm.length;
      if (pendingBytes >= CHUNK_BYTES) flush();
    };
    socket.onmessage = (event) => {
      try {
        const message = readTranscribeMessage(event.data, results);
        if (message.error) onError(message.error);
        else if (message.text !== undefined) onText(message.text);
      } catch (error) {
        onError(String(error));
      }
    };
    socket.onclose = () => this.finish(onEnd);
    socket.onerror = () => onError('Could not reach Amazon Transcribe.');
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      setTimeout(() => reject(new Error('Amazon Transcribe did not answer.')), 8_000);
    });
    if (this.ended) {
      socket.close();
      return;
    }
    if (preroll) for (const pcm of this.microphone.preroll()) queue(pcm);
    this.unsubscribe = this.microphone.subscribe(queue);
    this.timer = setTimeout(() => this.stop(), MAX_STREAM_MS);
  }

  finish(onEnd) {
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.socket = null;
    if (!this.ended) {
      this.ended = true;
      onEnd();
    }
  }

  /** Ends the stream politely: an empty audio event, then Transcribe closes the socket. */
  stop() {
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(encodeAudioEvent(new Uint8Array()));
      setTimeout(() => socket.close(), 1_500);
    }
  }

  abort() {
    this.ended = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
  }
}

/** The browser's recognizer (Chrome, Edge), continuous, always US English. */
export class BrowserEngine {
  constructor(Recognition) {
    this.Recognition = Recognition;
    this.rec = null;
  }

  async start({ onText, onEnd, onError }) {
    const rec = new this.Recognition();
    rec.lang = LANGUAGE; // never the browser's or the operating system's language
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) =>
      onText(
        Array.from(event.results)
          .map((r) => r[0].transcript)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    rec.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') onError(event.error);
    };
    rec.onend = () => {
      if (this.rec !== rec) return; // aborted on purpose
      this.rec = null;
      onEnd();
    };
    this.rec = rec;
    rec.start();
  }

  stop() {
    this.rec?.stop();
  }

  abort() {
    const rec = this.rec;
    this.rec = null;
    rec?.abort();
  }
}
