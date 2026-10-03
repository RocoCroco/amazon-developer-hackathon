// AWS event stream encoding, the framing Amazon Transcribe streaming uses over the WebSocket (T10.1).
// Message: [total length u32][headers length u32][prelude CRC32][headers][payload][message CRC32], big-endian.
// Header: [name length u8][name][type u8 = 7 (string)][value length u16][value].
// https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html#streaming-event-stream

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 as in gzip (RFC 1952). */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeHeaders(headers) {
  const parts = [];
  for (const [name, value] of Object.entries(headers)) {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    const part = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    const view = new DataView(part.buffer);
    part[0] = n.length;
    part.set(n, 1);
    part[1 + n.length] = 7; // string
    view.setUint16(2 + n.length, v.length);
    part.set(v, 4 + n.length);
    parts.push(part);
  }
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** One event stream message with string headers. */
export function encodeMessage(headers, payload) {
  const head = encodeHeaders(headers);
  const total = 16 + head.length + payload.length;
  const message = new Uint8Array(total);
  const view = new DataView(message.buffer);
  view.setUint32(0, total);
  view.setUint32(4, head.length);
  view.setUint32(8, crc32(message.subarray(0, 8)));
  message.set(head, 12);
  message.set(payload, 12 + head.length);
  view.setUint32(total - 4, crc32(message.subarray(0, total - 4)));
  return message;
}

/** An AudioEvent carrying 16-bit little-endian PCM; an empty one ends the stream. */
export function encodeAudioEvent(pcm) {
  return encodeMessage(
    {
      ':content-type': 'application/octet-stream',
      ':event-type': 'AudioEvent',
      ':message-type': 'event',
    },
    pcm,
  );
}

// Header value types with a fixed size: 2 byte, 3 short, 4 integer, 5 long, 8 timestamp, 9 uuid.
const FIXED_SIZE = { 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 };

/** Decodes one message: { headers, payload }. Throws on a bad length or checksum. */
export function decodeMessage(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = view.getUint32(0);
  const headersLength = view.getUint32(4);
  if (total !== bytes.length) throw new Error('event stream: length mismatch');
  if (view.getUint32(8) !== crc32(bytes.subarray(0, 8)))
    throw new Error('event stream: bad prelude CRC');
  if (view.getUint32(total - 4) !== crc32(bytes.subarray(0, total - 4))) {
    throw new Error('event stream: bad message CRC');
  }
  const headers = {};
  let offset = 12;
  const end = 12 + headersLength;
  while (offset < end) {
    const nameLength = bytes[offset];
    const name = decoder.decode(bytes.subarray(offset + 1, offset + 1 + nameLength));
    offset += 1 + nameLength;
    const type = bytes[offset];
    offset += 1;
    if (type === 6 || type === 7) {
      // byte array or string, with a 2-byte length
      const length = view.getUint16(offset);
      const value = bytes.subarray(offset + 2, offset + 2 + length);
      headers[name] = type === 7 ? decoder.decode(value) : value;
      offset += 2 + length;
    } else if (type === 0 || type === 1) {
      headers[name] = type === 0;
    } else if (FIXED_SIZE[type]) {
      // byte, short, integer, long, timestamp (ms), uuid: kept as raw bytes, we never need their value
      headers[name] = bytes.subarray(offset, offset + FIXED_SIZE[type]);
      offset += FIXED_SIZE[type];
    } else {
      throw new Error(`event stream: unknown header type ${type}`);
    }
  }
  return { headers, payload: bytes.subarray(end, total - 4) };
}

/**
 * Turns a Transcribe message into { text } for a transcript event (all results, partial ones included, in
 * order) or { error } for an exception. `results` keeps the latest text per ResultId across events.
 */
export function readTranscribeMessage(data, results) {
  const { headers, payload } = decodeMessage(data);
  const body = decoder.decode(payload);
  if (headers[':message-type'] === 'exception') {
    return { error: `${headers[':exception-type'] ?? 'Exception'}: ${body}` };
  }
  if (headers[':event-type'] !== 'TranscriptEvent') return {};
  const event = JSON.parse(body);
  let final = false;
  for (const result of event.Transcript?.Results ?? []) {
    const text = result.Alternatives?.[0]?.Transcript ?? '';
    results.set(result.ResultId, text);
    // Transcribe marks a segment final when the speaker paused: a strong sign the sentence is over.
    final = result.IsPartial === false;
  }
  return {
    text: [...results.values()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    final,
  };
}
