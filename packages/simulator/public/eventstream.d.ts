// Types for eventstream.js (plain JS so the browser loads it as is); used by the tests.
export function crc32(bytes: Uint8Array): number;
export function encodeMessage(
  headers: Record<string, string>,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer>;
export function encodeAudioEvent(pcm: Uint8Array): Uint8Array<ArrayBuffer>;
export function decodeMessage(data: ArrayBuffer | Uint8Array): {
  headers: Record<string, string | boolean | Uint8Array>;
  payload: Uint8Array;
};
export function readTranscribeMessage(
  data: ArrayBuffer | Uint8Array,
  results: Map<string, string>,
): { text?: string; final?: boolean; error?: string };
