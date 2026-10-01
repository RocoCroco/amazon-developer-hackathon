# PROGRESS

_Last updated: 2026-10-01_

## Current task
T4.3 - Voice-first review of every tool response (SPEC section 5): each tool has a test asserting a SHORT spoken summary. Known TODO from earlier: model codes are spaced for TTS ("H 7 1 3 1") inside `summary`, which also shows in the written transcript; add a separate `spoken` field (spaced codes) and keep `summary` readable, or decide which the simulator displays/speaks.

## Done
- Phase 0-3; T4.1 (list_items, update_item, remove_item with two-step confirm); T4.2 (check_household, get_alerts, get_remedy, resolve_alert; alerts.ts, dynamo-alerts.ts, household-check.ts [checkItems/recordAlerts with supersede option, reused by the watcher], remedy.ts, severity.ts). 9 MCP tools total. 238 tests green, lint clean.
- Alert rules: id = hash(item+recall) so no duplicates; resolved stays resolved unless a question became a confirmed recall (then reopens, counts as new); confirmed never downgraded; items with only open questions get ONE alert (best candidate); full checks supersede stale questions, the watcher must call recordAlerts WITHOUT supersede.
- NOT redeployed since T1.6: deployed Lambda is old (2 tools). Redeploy in T4.4 together with the watcher: `cd infra && npm run deploy`, then `node scripts/smoke-deployed.mjs` (update the script for new tools if needed).

## Left (T4.3)
- Audit all 9 tool summaries: one or two short sentences, no URLs/markup, numbers as words/digits for speech, no raw model codes read as words. Add tests/spoken-summaries.test.ts that calls every tool and asserts: summary length < ~280 chars, no "http", no JSON-looking text, ends with a sentence terminator, details only in structuredContent.
- Add `spoken` field (model/part codes spaced) where codes appear; make `summary` the display text. Check the simulator UI/agent system prompt (packages/simulator/src/agent.ts SYSTEM_PROMPT) mentions the new tools; update the mock brain if needed.

## Next step
Write packages/mcp-server/src/spoken-summaries.test.ts that drives every tool through the MCP client and asserts the spoken-summary rules above; fix whatever fails.
