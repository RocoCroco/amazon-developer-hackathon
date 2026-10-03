import { fetchWithin, LOOKUP_TIMEOUT_MS, type FetchLike } from './cpsc.js';

const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

/** 17 characters, letters I, O and Q are never used in VINs. */
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

export interface DecodedVin {
  make: string;
  model: string;
  year: number;
  /** True when vPIC decoded the full VIN without errors. */
  complete: boolean;
}

export function isValidVinFormat(vin: string): boolean {
  return VIN.test(vin.trim().toUpperCase());
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());

interface VpicResult {
  Make?: string;
  Model?: string;
  ModelYear?: string;
  ErrorCode?: string;
}

/**
 * Decodes a VIN with NHTSA vPIC. Returns undefined when the VIN is malformed or vPIC could not
 * identify make, model and year. `fetchFn` is injectable for tests.
 */
export async function decodeVin(
  vin: string,
  fetchFn: FetchLike = fetchWithin(LOOKUP_TIMEOUT_MS),
): Promise<DecodedVin | undefined> {
  const clean = vin.trim().toUpperCase();
  if (!isValidVinFormat(clean)) return undefined;

  const res = await fetchFn(`${VPIC_URL}/${clean}?format=json`);
  if (!res.ok) throw new Error(`vPIC returned HTTP ${res.status}`);
  const row = ((await res.json()) as { Results?: VpicResult[] }).Results?.[0];
  const year = Number(row?.ModelYear);
  if (!row?.Make || !row.Model || !year) return undefined;

  // ErrorCode is a comma-separated list; "0" alone means a clean decode.
  const codes = (row.ErrorCode ?? '').split(',').map((c) => c.trim());
  return {
    make: titleCase(row.Make),
    model: row.Model,
    year,
    complete: codes.length === 1 && codes[0] === '0',
  };
}
