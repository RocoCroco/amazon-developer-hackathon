# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.2 - common `Recall` schema + CPSC adapter (packages/mcp-server/src/recalls/).

## Done
- Phase 0 complete. T1.1 done: docs/data-sources.md + fixtures in packages/mcp-server/test/fixtures/.
- Key facts: CPSC has since-date filters but Products[].Model is empty (parse text); NHTSA vehicle API has no since-date; car seats only in the bulk flat file; openFDA has date search.

## Left
- Define `Recall` type (source, id, title, summary, hazard, remedy, remedyOptions, contact, url, publishedAt, products[{name, brand?, models[], units?}], category) and `fromCpsc()` with fixture tests.

## Next step
Create packages/mcp-server/src/recalls/types.ts and cpsc.ts + cpsc.test.ts using test/fixtures/cpsc-space-heater.json.
