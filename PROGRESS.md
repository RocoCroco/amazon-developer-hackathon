# PROGRESS

_Last updated: 2026-10-01_

## Current task
T5.3 - Deploy the simulator publicly (S3/CloudFront or Lambda Function URL), abuse limits in place. Done when reachable via a public URL.

## Done
- Phase 0-4; T5.1 (voice: push-to-talk, Polly with browser fallback, alerts panel, proactive messages) and T5.2 (demo mode: `Load sample family`, `Simulate new recall` -> real watcher, Reset cleans the household; SPEC s8 story passes 3x in a row: packages/simulator/src/demo-story.test.ts). B1 resolved (Bedrock works; live tests pass). 318 tests green.
- Simulator config (packages/simulator/src/main.ts env): MCP_URL, DEMO_KEY, SIM_LLM=mock (offline brain) or Bedrock default, SPEECH=off, POLLY_VOICE_ID, WATCHER_FUNCTION (enables demo buttons; the host needs lambda:InvokeFunction).

## Left (T5.3 design)
- The simulator is a stateful Node server (in-memory sessions with MCP connections). On Lambda, sessions would not persist across invocations. Options: (a) one Lambda Function URL with reserved concurrency 1 won't work reliably; (b) make the Lambda handler stateless: keep conversation history in DynamoDB keyed by session id (Session = messages + household id; MCP connection recreated per request, cheap since the MCP server is stateless); (c) run as a single warm container... Prefer (b): `SessionStore` in DynamoDB (messages JSON, turns, createdAt, TTL 1 day), simulator Lambda handler = same `handle()` routing (refactor server.ts so the request handler is a pure function `(Request) => Response` like the MCP handler, with node and Lambda adapters), static UI served from the same Lambda (small files) or S3.
- Public HTTPS: Lambda Function URL (no CloudFront needed) for UI + API; Polly + Bedrock + Lambda invoke (watcher) IAM on the role; env: MCP_URL (the MCP function URL), DEMO_KEY param (SSM), WATCHER_FUNCTION.
- Abuse limits: per-session turn limit (exists, persist it), speech budget (per session + daily; persist in DynamoDB or keep per-container best effort), daily global cap on model calls (DynamoDB atomic counter), message size limit (exists), reserved concurrency when B3 quota arrives.
- Deploy via CDK in the same stack, then verify with Playwright against the deployed URL (scripts) and add the URL to README/docs/manual-checklist.

## Next step
Refactor packages/simulator/src/server.ts into a runtime-agnostic handler (Request -> Response) plus node adapter, add SessionStore interface (in-memory + DynamoDB) so Session can be rebuilt from stored messages, and keep all existing tests green.
