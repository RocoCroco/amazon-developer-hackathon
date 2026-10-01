# PROGRESS

_Last updated: 2026-10-01_

## Current task
T5.1 - Voice in the simulator: push-to-talk via Web Speech API recognition, spoken replies via Amazon Polly (neural, serverless, cached/limited), text fallback, alerts panel polling get_alerts, Alexa-like look. Done when the full demo story works by typing (Playwright); voice path verified by script where possible, the rest in docs/manual-checklist.md.

## Done
- Phase 0-4 complete (T4.5 cost doc: docs/costs.md, ~ $8/month at demo usage, Bedrock Haiku + Polly dominate). DEPLOYED: MCP Lambda (9 tools), watcher Lambda + daily rule, DynamoDB. 266 tests green.
- Simulator today: packages/simulator (server.ts, agent.ts [system prompt covers all 9 tools], llm.ts, mock-brain.ts, public/{index,app.js,styles.css}); text UI works against a local or deployed MCP; real Bedrock still blocked (B1) so SIM_LLM=mock is the offline brain. Mock brain only knows add_item/check_item: extend it (list/alerts/remedy/resolve intents) so the offline demo covers the SPEC section 8 story.

## Left (Phase 5 and 6, 7)
- T5.1 voice (Polly via a /api/speak endpoint in the simulator backend: text -> SSML (spell model codes with <say-as interpret-as="characters">, phone digits) -> Polly neural MP3 -> browser plays; cache by hash; length/rate limits; browser SpeechSynthesis fallback if Polly unavailable), alerts panel (poll /api/alerts every few seconds -> get_alerts), transcript/inventory improvements (inventory via list_items instead of parsing tool traces), push-to-talk button with webkitSpeechRecognition + text fallback.
- T5.2 demo mode: seeded household (stable demo household id), "simulate new recall" button (backend invokes the watcher Lambda with a seeded recall via AWS SDK lambda:InvokeCommand), reset button; run the SPEC section 8 story 3 times in a row by script.
- T5.3 deploy simulator publicly (S3/CloudFront or Lambda Function URL), abuse limits (turn limit exists; add daily cap on model calls).
- Phase 6: E2E story test, README (architecture diagram, setup), verify stats (6% vs 50%, Amazon claim), final FRICTION/FEEDBACK, video script, Devpost text, manual checklist. Phase 7: secret scan, make public / share with judges (human).

## Next step
Extend packages/simulator/src/mock-brain.ts to cover list/alerts/remedy/resolve/check-everything intents with tests, then add the Polly /api/speak endpoint (packages/simulator/src/speech.ts) using @aws-sdk/client-polly with a fake client in tests.
