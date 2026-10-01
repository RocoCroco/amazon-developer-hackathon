# BLOCKERS

## B1 - Bedrock model access (blocks: live verification of T1.7, T3.2 real call; everything else uses mocks)
- 2026-10-01 ~19:2x: real Converse calls succeeded for `us.anthropic.claude-haiku-4-5-20251001-v1:0` and `us.anthropic.claude-sonnet-4-6`.
- A few minutes later the SAME calls (CLI and SDK) fail: `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form ... try again in 15 minutes.`
- `us.anthropic.claude-sonnet-5-5` returned AccessDenied ("not available for this account") earlier.
- Human action: in the Bedrock console (us-east-1) complete the Anthropic use-case details form / model access for Claude Haiku 4.5 (and Sonnet 4.6 optional), then wait ~15 min.
- Workaround: ScriptedLlm mock in tests. Once access works, run `npm run test:live` (packages/simulator/src/live.test.ts) and mark T1.7 [x].
- Decision: dev/tests/default model = Haiku 4.5, configurable via BEDROCK_MODEL_ID.

## B2 - Repo visibility / judge sharing (blocks: T7.2)
- What: human decides: make public, or keep private and share with the judging team (docs/rules.md). Mini challenges may need public.
- Why: submission requirement.

## B3 - Lambda concurrency quota is 10 (blocks: nothing; hardens T1.6/T5.3) 
- What: request a Service Quotas increase for "Concurrent executions" (Lambda, us-east-1), e.g. to 100, so reserved concurrency can cap the public functions.
- Why: new-account quota of 10 leaves no room for reserved concurrency; an abusive caller could starve the daily watcher.
- Workaround in place: demo key, 30 s timeout, simulator turn limits.
