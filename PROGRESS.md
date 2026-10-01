# PROGRESS

_Last updated: 2026-10-01_

## Current task
T2.1 - NHTSA adapter (vehicles via recallsByVehicle + car seats/equipment/tires via the bulk flat file) + VIN decode (vPIC). Car seat recall must be findable from brand + model.

## Done
- Phase 0; Phase 1 (thin slice) T1.1-T1.8 complete: deployed MCP server (Lambda URL + DynamoDB), simulator backend + text UI with real-browser tests. T1.7 is `[!]` only for the live Bedrock verification (BLOCKERS B1; retry `npm run test:live` later).
- 65 tests green. Local run instructions in README.

## Left (Phase 2+)
- T2.1 NHTSA adapter; T2.2 openFDA adapter; T2.3 cache/incremental; Phase 3 matcher quality (>=50 pairs), LLM confirm (B1), clarifying questions; Phase 4 remaining tools + watcher + costs; Phase 5 voice/Polly, demo mode, deploy simulator; Phase 6 docs; Phase 7 release.
- Ideas noted: tool responses should carry `spoken` (model codes spaced for TTS) separate from the display `summary` (transcript currently shows "H 7 1 3 1") -> do in T4.3. Mock brain has no update_item yet -> revisit in T4.1. Retry Bedrock periodically (B1).

## Next step
Write packages/mcp-server/src/recalls/nhtsa.ts: (1) `fromNhtsaVehicle(raw)` for recallsByVehicle JSON (fixture test/fixtures/nhtsa-recalls-by-vehicle-camry-2020.json; dates MM/DD/YYYY; fields Manufacturer, NHTSACampaignNumber, Component, Summary, Consequence, Remedy, Make, Model, ModelYear); (2) `parseFlatFile(lines)` -> Recall[] for RCL.txt rows (tab-delimited, fields in docs/data-sources.md; fixture test/fixtures/nhtsa-flat-sample.txt; category C=car_seat, E=equipment, T=tire, V=vehicle; YEARTXT 9999 = unknown); (3) `decodeVin()` via vPIC DecodeVinValues with fetch injection. Then tests.
