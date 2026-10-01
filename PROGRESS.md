# PROGRESS

_Last updated: 2026-10-01_

## Current task
T2.3 - Recall cache with incremental fetch. Files to create in packages/mcp-server/src/recalls/: cache.ts (RecallStore interface + InMemoryRecallStore: upsert -> {added, updated, unchanged}, cursors per source, candidates(item) by brand token), sync.ts (syncSource(store, fetcher, now, overlapDays) with cursor handling), flatfile.ts (stream NHTSA zip: manual local-header parse + zlib.createInflateRaw, readline, filter RCDATE >= since). Tests: no duplicates, incremental since=cursor-overlap, failure keeps cursor, overlap re-fetch counts as unchanged not added.

## Done
- Phase 0; Phase 1 (T1.7 live Bedrock blocked by B1); T2.1 (NHTSA + vPIC); T2.2 (openFDA adapter, Recall.severity added). 87 tests green.
- NOTE for T3.1: matcher uses recall.years union -> switch to per-product years.
- LESSON: regex-bearing code only via Write/Edit tools (FRICTION F7).

## Left
- T2.3 as above; DynamoRecallStore comes with the watcher (T4.4).

## Next step
Write recalls/cache.ts with the RecallStore interface and InMemoryRecallStore, then sync.ts, then flatfile.ts, then tests.
