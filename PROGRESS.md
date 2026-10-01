# PROGRESS

_Last updated: 2026-10-01_

## Current task
T3.2 - LLM confirmation step via Bedrock returning {match, confidence, reason, clarifying_question}; cheapest Claude model (Haiku 4.5: us.anthropic.claude-haiku-4-5-20251001-v1:0), cache per item-recall pair, mocked Bedrock in tests, real call blocked by B1 (retry `aws bedrock-runtime converse` once; if it still says "use case details not submitted", keep the mock and leave the live check in BLOCKERS).

## Done
- Phase 0; Phase 1 (T1.7 live Bedrock only blocked, B1); Phase 2 (T2.1-T2.3); T3.1 matcher v2 (src/matcher/: normalize.ts, model.ts, match.ts) with eval on a 1,313-recall real corpus (test/corpus/, scripts/fetch-matcher-corpus.mjs): hand set 69 items + generated 432 items; strong precision/recall 100%/100% on both; history + limits in docs/matcher-results.md. 118 tests green.
- Matcher semantics: strong needs identifying evidence (see docs/matcher-results.md table); `possible` carries `missing` = model|year|lot; Match has `product`. Vehicles: exact model + product-line model year; seats/tires/equipment: production window (or sticker code); food/drug: never strong (ask for lot).

## Left (T3.2)
- src/matcher/confirm.ts: `ConfirmLlm` interface {judge(item, recall, deterministicMatch) -> {match: 'yes'|'no'|'unsure', confidence: 0..1, reason, clarifying_question?}}; BedrockConfirmer (Converse API, JSON-only prompt, temperature 0, haiku), CachedConfirmer (per hash(item brand/name/model/year + recall.id + recall fingerprint); in-memory now, DynamoDB later), ScriptedConfirmer for tests.
- Rule: LLM may only DOWNGRADE or ask (strong -> possible/no), never upgrade a possible to strong without new facts; precision on eval set must not drop (run the eval with a mock that confirms deterministic strong and answers 'unsure' for possible).
- Wire into check_item: for 'possible'/'strong' matches call the confirmer; if unsure -> status need_info with its clarifying_question.

## Next step
Write src/matcher/confirm.ts (types + prompt builder + parse/validate JSON + cache) and confirm.test.ts with a scripted LLM; then try one real Bedrock call.
