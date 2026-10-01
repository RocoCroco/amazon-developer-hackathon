# BLOCKERS

## B1 - Bedrock model access (blocks: T3.2 real call, T1.7 real Claude)
- What: human enables Bedrock Claude model access in us-east-1 (said they would do it on 2026-10-01).
- Why: needed for the LLM confirmation step and the simulator brain.
- Workaround: Bedrock is mocked until access is confirmed; verify available model IDs in the account first.

## B2 - Repo visibility / judge sharing (blocks: T7.2)
- What: human decides: make public, or keep private and share with the judging team (docs/rules.md). Mini challenges may need public.
- Why: submission requirement.

## B3 - Lambda concurrency quota is 10 (blocks: nothing; hardens T1.6/T5.3) 
- What: request a Service Quotas increase for "Concurrent executions" (Lambda, us-east-1), e.g. to 100, so reserved concurrency can cap the public functions.
- Why: new-account quota of 10 leaves no room for reserved concurrency; an abusive caller could starve the daily watcher.
- Workaround in place: demo key, 30 s timeout, simulator turn limits.
