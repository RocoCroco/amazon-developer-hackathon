// Builds the real-data corpus used to evaluate the matcher (T3.1), trimmed to the fields our adapters read.
// Usage: node scripts/fetch-matcher-corpus.mjs <path-to-FLAT_RCL_POST_2010.txt>
// (the flat file comes from https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip, see docs/data-sources.md)
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const OUT = 'packages/mcp-server/test/corpus';
mkdirSync(OUT, { recursive: true });
const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s);
const save = (name, data) =>
  writeFileSync(`${OUT}/${name}`, typeof data === 'string' ? data : JSON.stringify(data));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// 1. CPSC: a year of recalls.
const cpsc = await getJson(
  'https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2025-10-01',
);
save(
  'cpsc.json',
  cpsc.map((r) => ({
    RecallID: r.RecallID,
    RecallNumber: r.RecallNumber,
    RecallDate: r.RecallDate,
    LastPublishDate: r.LastPublishDate,
    Title: r.Title,
    Description: clip(r.Description, 1200),
    URL: r.URL,
    ConsumerContact: clip(r.ConsumerContact, 300),
    Products: r.Products.map((p) => ({ Name: p.Name, Model: p.Model })),
    Hazards: r.Hazards.map((h) => ({ Name: clip(h.Name, 400) })),
    Remedies: r.Remedies.map((x) => ({ Name: clip(x.Name, 400) })),
    RemedyOptions: r.RemedyOptions,
    Manufacturers: r.Manufacturers.map((m) => ({ Name: m.Name })),
    Importers: r.Importers.map((m) => ({ Name: m.Name })),
  })),
);
console.log('cpsc', cpsc.length);

// 2. openFDA: the latest 100 food and 100 drug records.
for (const kind of ['food', 'drug']) {
  const body = await getJson(
    `https://api.fda.gov/${kind}/enforcement.json?sort=report_date:desc&limit=100`,
  );
  save(
    `openfda-${kind}.json`,
    body.results.map((r) => ({
      recall_number: r.recall_number,
      event_id: r.event_id,
      recalling_firm: r.recalling_firm,
      product_description: clip(r.product_description, 500),
      reason_for_recall: clip(r.reason_for_recall, 300),
      classification: r.classification,
      report_date: r.report_date,
      code_info: clip(r.code_info, 300),
      distribution_pattern: clip(r.distribution_pattern, 150),
    })),
  );
  console.log('openfda', kind, body.results.length);
}

// 3. NHTSA vehicle API: a few makes/models/years.
const vehicles = [
  ['toyota', 'camry', 2020],
  ['honda', 'civic', 2019],
  ['ford', 'f-150', 2018],
  ['chevrolet', 'silverado 1500', 2019],
  ['tesla', 'model 3', 2020],
  ['hyundai', 'elantra', 2018],
];
const vehicleResults = [];
for (const [make, model, year] of vehicles) {
  const body = await getJson(
    `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${make}&model=${encodeURIComponent(model)}&modelYear=${year}`,
  ).catch((e) => {
    console.warn('skipped vehicle:', e.message); // NHTSA answers 400 for models it does not know
    return { results: [] };
  });
  for (const r of body.results ?? []) {
    vehicleResults.push({
      Manufacturer: r.Manufacturer,
      NHTSACampaignNumber: r.NHTSACampaignNumber,
      ReportReceivedDate: r.ReportReceivedDate,
      Component: r.Component,
      Summary: clip(r.Summary, 800),
      Consequence: clip(r.Consequence, 400),
      Remedy: clip(r.Remedy, 400),
      Notes: clip(r.Notes, 300),
      ModelYear: r.ModelYear,
      Make: r.Make,
      Model: r.Model,
      parkIt: r.parkIt,
      parkOutSide: r.parkOutSide,
    });
  }
}
save('nhtsa-vehicles.json', vehicleResults);
console.log('nhtsa vehicle results', vehicleResults.length);

// 4. NHTSA flat file: every child-seat row, plus up to 2 rows per campaign for equipment/tire/vehicle
// campaigns received since 2025 (capped), so the corpus stays small but diverse.
const flatPath = process.argv[2];
if (!flatPath) throw new Error('pass the path to FLAT_RCL_POST_2010.txt');
const kept = [];
const perCampaign = new Map();
let others = 0;
const MAX_OTHER_ROWS = 700;
const lines = createInterface({ input: createReadStream(flatPath, { encoding: 'utf8' }) });
for await (const line of lines) {
  const f = line.split('	');
  if (f.length < 23) continue;
  const type = f[10];
  if (type !== 'C') {
    const seen = perCampaign.get(f[1]) ?? 0;
    if ((f[15] ?? '') < '20250101' || seen >= 2 || others >= MAX_OTHER_ROWS) continue;
    perCampaign.set(f[1], seen + 1);
    others += 1;
  }
  f[19] = clip(f[19], 900);
  f[20] = clip(f[20], 300);
  f[21] = clip(f[21], 300);
  f[22] = clip(f[22], 200);
  kept.push(f.slice(0, 23).join('	'));
}
save('nhtsa-flat.txt', [...kept, ''].join(String.fromCharCode(10)));
console.log('nhtsa flat rows', kept.length);
