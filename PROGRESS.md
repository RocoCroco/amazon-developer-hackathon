# PROGRESS

_Last updated: 2026-10-01_

## Current task
T4.4 - Daily watcher: EventBridge schedule -> Lambda -> alerts, deployed. Done when a manual invocation of the DEPLOYED Lambda creates alerts from a seeded recall.

## Done
- Phase 0-3; T4.1-T4.3. 9 MCP tools; voice-first rules enforced by src/spoken-summaries.test.ts (prints the whole voice script: `npx vitest run spoken-summaries`). Model codes stay natural in tool text (the speech layer will spell them with Polly SSML in T5.1). Simulator system prompt covers all tools. 243 tests green, lint clean.

## Left (T4.4)
- DynamoRecallStore (RecallStore interface in src/recalls/cache.ts: getCursor/setCursor/upsert/candidates): single table, SK=RECALL#<id> with GSI or per-brand index items (PK=BRAND#<normalizedBrand>, SK=RECALL#<id>) so candidates(item) is a Query, cursors under PK=CURSOR, SK=<source>. TTL not needed (or 1 year).
- src/watcher.ts: `runWatcher({recallStore, itemScan, alertStore, feeds, now})`: for each feed syncFeed -> `added` recalls (new ids) -> for each household with items: checkItems(items, new StaticRecallProvider(added)) -> recordAlerts WITHOUT supersede (partial view). Household enumeration: Dynamo Scan of PK begins_with HH# and SK begins_with ITEM# (small demo scale; document the cost/scale note) -> group by household.
- src/watcher-lambda.ts handler (+ optional `{seed: Recall[]}` event to inject a fake recall for demos/tests, and `{since}` override); returns a summary {feeds, addedRecalls, households, alertsCreated}.
- CDK: second NodejsFunction (timeout 5-10 min, 1024 MB for the NHTSA zip stream, env TABLE_NAME), EventBridge rule daily (cron 07:00 UTC), grant table RW; keep tags; test infra assertions.
- Deploy (cd infra && npm run deploy), invoke manually with `aws lambda invoke` using a seeded recall for a registered item (create via the MCP smoke script first), verify alerts via get_alerts, then run scripts/smoke-deployed.mjs again (update it for 9 tools).
- Concurrency quota is 10 account-wide (BLOCKERS B3): the watcher must not starve the MCP function; keep it a single invocation.

## Next step
Write src/recalls/dynamo-recall-store.ts implementing RecallStore (+ tests with the fake-table pattern from src/store.test.ts), then src/watcher.ts with unit tests using InMemory stores and fake feeds.
