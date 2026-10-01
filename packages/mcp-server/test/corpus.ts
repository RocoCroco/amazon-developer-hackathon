import { readFileSync } from 'node:fs';
import { fromCpsc, type CpscRecall } from '../src/recalls/cpsc.js';
import {
  fromNhtsaVehicleResults,
  parseFlatFile,
  type NhtsaVehicleResult,
} from '../src/recalls/nhtsa.js';
import { fromOpenFda, type OpenFdaRecord } from '../src/recalls/openfda.js';
import type { Recall } from '../src/recalls/types.js';

const read = (name: string) => readFileSync(new URL(`./corpus/${name}`, import.meta.url), 'utf8');

/** Real recalls from CPSC, NHTSA (vehicle API + flat file) and openFDA, see scripts/fetch-matcher-corpus.mjs. */
export function loadCorpus(): Recall[] {
  const all = [
    ...(JSON.parse(read('cpsc.json')) as CpscRecall[]).map(fromCpsc),
    // Older heater recalls (Govee, Shop LC) used throughout the tests.
    ...(
      JSON.parse(
        readFileSync(new URL('./fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
      ) as CpscRecall[]
    ).map(fromCpsc),
    ...fromNhtsaVehicleResults(JSON.parse(read('nhtsa-vehicles.json')) as NhtsaVehicleResult[]),
    ...parseFlatFile(read('nhtsa-flat.txt').split('\n').filter(Boolean)),
    ...fromOpenFda(JSON.parse(read('openfda-food.json')) as OpenFdaRecord[], 'food'),
    ...fromOpenFda(JSON.parse(read('openfda-drug.json')) as OpenFdaRecord[], 'drug'),
  ];
  return [...new Map(all.map((r) => [r.id, r])).values()];
}
