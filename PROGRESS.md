# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.3 - basic deterministic matcher (brand alias + model + year normalization) over the `Recall` schema, tested on CPSC fixtures.

## Done
- Phase 0, T1.1, T1.2 (Recall schema in src/recalls/types.ts, CPSC adapter + text helpers, 10 tests green).
- Learned: CPSC titles vary ("Recalls"/"Recalled"); brands also appear in quoted marking sentences; models only in text.

## Left
- src/matcher/: normalize (lowercase, strip punctuation/corp suffixes, brand aliases e.g. "graco"/"graco children's products"), model compare (case/dash-insensitive, exact token), year/date check; `matchItem(item, recalls) -> {recall, score, reasons, missing[]}` where `missing` lists what to ask (model, year).
- Tests with positive + hard-negative pairs from fixtures.

## Next step
Create packages/mcp-server/src/matcher/types.ts (Item type: name, brand?, model?, year?, category?) and normalize.ts with tests.
