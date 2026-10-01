# PROGRESS

_Last updated: 2026-10-01_

## Current task
T4.1 - `list_items`, `update_item`, `remove_item` MCP tools (confirm before destructive actions). Done when tool tests pass.

## Done
- Phase 0; Phase 1 (T1.7 live Bedrock only blocked, B1); Phase 2; Phase 3: T3.1 matcher + eval (docs/matcher-results.md), T3.2 confirmer ([!] live call only), T3.3 clarifying flows (src/matcher/clarify.ts; tool statuses recalled | need_info | no_recall | outside_period; Missing = model|year|month|lot; Item.month added; tools accept `month`). 170 tests green, lint clean.
- NOT redeployed since T1.6: the deployed Lambda has the old matcher. Redeploy (`cd infra && npm run deploy`) happens in T4.4 (watcher) - remember `node scripts/smoke-deployed.mjs` afterwards.

## Left (T4.1)
- ItemStore interface (src/store.ts): add updateItem(householdId, itemId, patch) and removeItem(householdId, itemId); implement in InMemoryItemStore and DynamoItemStore (UpdateCommand/DeleteCommand; tests with aws-sdk-client-mock).
- Tools in src/tools.ts: list_items (spoken summary "You have 3 items: ..."), update_item (item_id + fields; summary), remove_item (two-step: first call without confirm=true returns need_confirmation and asks "Do you want me to remove your X?", only confirm:true deletes) - SPEC §5 "Confirm before destructive actions".
- Also let check_item with a registered item_id use month; and update the simulator mock brain/system prompt for the new tools (packages/simulator/src/agent.ts SYSTEM_PROMPT mentions tools).

## Next step
Extend ItemStore with updateItem/removeItem (+ in-memory + Dynamo impls and tests), then add the three tools.
