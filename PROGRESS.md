# PROGRESS

_Last updated: 2026-10-01_

## Current task
T4.5 - Cost check: write docs/costs.md with an estimate of monthly cost at demo usage; Done when the estimate is < $10/month.

## Done
- Phase 0-3; T4.1-T4.4. DEPLOYED (us-east-1, stack RecallGuardianStack): MCP Lambda (9 tools, Function URL, demo key in SSM), watcher Lambda (daily 07:00 UTC EventBridge rule, 1024 MB, 10 min), DynamoDB single table (inventory, alerts, recall cache, cursors). `node scripts/smoke-deployed.mjs` and `node scripts/verify-watcher.mjs` pass against the deployed system (the latter: seeded recall -> real watcher run over 109 live recalls -> proactive alert -> remedy, then cleans up). 266 tests green, lint clean.
- Demo-mode hook for T5.2: invoke the watcher Lambda with {"seed":[Recall]} (see scripts/verify-watcher.mjs); the simulator backend will need lambda:InvokeFunction permission (or an HTTP route) to "simulate a new recall".

## Left (T4.5)
- docs/costs.md: Lambda (requests + GB-seconds; free tier), DynamoDB on-demand (reads/writes of the daily watcher + demo usage), CloudWatch logs (1 week retention), SSM standard parameter (free), EventBridge (free for scheduled rules), Bedrock (Haiku 4.5 per token, assumptions: N conversations/day x tokens), Polly (neural: $16 per 1M chars), S3/CloudFront for the simulator, data transfer. Use real usage numbers where known (watcher run duration/memory from CloudWatch: `aws logs`/Lambda REPORT lines). Total must be < $10/month.

## Next step
Get the watcher's real REPORT line (duration, memory used) from CloudWatch Logs for the log group of WatcherFunction (aws logs filter-log-events ... --filter-pattern REPORT), then write docs/costs.md.
