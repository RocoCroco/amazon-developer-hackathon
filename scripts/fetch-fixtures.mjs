// Fetches small real API responses and saves them as test fixtures (T1.1).
// Usage: node scripts/fetch-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'packages/mcp-server/test/fixtures';
mkdirSync(OUT, { recursive: true });

const sources = {
  'cpsc-space-heater.json':
    'https://www.saferproducts.gov/RestWebServices/Recall?format=json&ProductName=space%20heater&RecallDateStart=2020-01-01',
  'cpsc-since-2026-09-15.json':
    'https://www.saferproducts.gov/RestWebServices/Recall?format=json&LastPublishDateStart=2026-09-15',
  'nhtsa-recalls-by-vehicle-camry-2020.json':
    'https://api.nhtsa.gov/recalls/recallsByVehicle?make=toyota&model=camry&modelYear=2020',
  'vpic-decode-vin.json':
    'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/5UXWX7C5*BA?format=json&modelyear=2011',
  'openfda-food-enforcement.json':
    'https://api.fda.gov/food/enforcement.json?search=report_date:[20260901+TO+20261001]&sort=report_date:desc&limit=5',
  'openfda-drug-enforcement.json':
    'https://api.fda.gov/drug/enforcement.json?search=report_date:[20260901+TO+20261001]&sort=report_date:desc&limit=5',
};

for (const [file, url] of Object.entries(sources)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const json = await res.json();
  // Keep fixtures small: trim top-level arrays to 10 entries.
  const trim = (v) => (Array.isArray(v) ? v.slice(0, 10) : v);
  const body = Array.isArray(json)
    ? trim(json)
    : Object.fromEntries(Object.entries(json).map(([k, v]) => [k, trim(v)]));
  writeFileSync(`${OUT}/${file}`, JSON.stringify(body, null, 2) + '\n');
  console.log('saved', file);
}
