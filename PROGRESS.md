# PROGRESS

_Last updated: 2026-10-01_

## Current task
T3.3 - Clarifying-question flow when confidence is low. Tests must cover "unknown model", "ambiguous brand", "wrong year".

## Done
- Phase 0; Phase 1 (T1.7 live Bedrock only blocked, B1); Phase 2; T3.1 matcher v2 + real-corpus evaluation (docs/matcher-results.md); T3.2 code done ([!] for the live Bedrock call only): src/matcher/confirm.ts (Confirmer, BedrockConfirmer, CachedConfirmer, ScriptedConfirmer, applyVerdict = downgrade-only, confirmMatches: outage leaves the automatic result unchanged), wired through McpDeps.confirmer -> ToolContext.confirmer -> check_item. 143 tests green.
- Lambda does NOT use the confirmer yet (src/lambda.ts passes none). To enable later: CachedConfirmer(new BedrockConfirmer()) behind env CONFIRM_WITH_LLM=true + IAM bedrock:InvokeModel (inference profile ARNs) in infra, only after B1 is resolved.

## Left (T3.3)
- Today check_item asks one question from `missing[0]` (model|year|lot) or the model's question. Add the three flows with tests through the MCP tool:
  1. unknown model ("I don't know the model"): add_item/check_item w/o model -> question says where the sticker usually is; accept approximate year as alternative (SPEC §5: photo-free alternative).
  2. ambiguous brand (user says a brand we can't pin down, e.g. "Graco" vs "Graco Children's Products", or a misspelling like "Evenfloe", or a store/parent brand): fuzzy brand suggestions -> "Did you mean Evenflo?" (Levenshtein <= 1-2 against brands seen in candidates; never auto-accept).
  3. wrong year (year outside the recalled window/years): say it's likely not affected but name the recalled period so the owner can re-check ("this recall covers seats made between X and Y").
- Also a `clarify` result type in tools.ts: status 'need_info' with `still_needed` + `question`.

## Next step
Write src/matcher/clarify.ts: pure function `clarify(item, matches, candidates) -> {kind: 'model'|'year'|'lot'|'brand'|'period', question: string} | undefined` + unit tests; then use it in tools.ts check().
