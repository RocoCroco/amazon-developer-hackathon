# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.7 - Simulator backend (text mode): Claude on Bedrock as the assistant, connected to the deployed MCP server as a real MCP client; per-session turn limit. Bedrock is MOCKED until the human enables model access (BLOCKERS B1) - first check `aws bedrock list-foundation-models` / try an invoke to see if access is already on.

## Done
- Phase 0; T1.1-T1.6. Deployed stack RecallGuardianStack (us-east-1): Lambda Function URL (get with `aws cloudformation describe-stacks`; output McpUrl), DynamoDB table, SSM SecureString /recall-guardian/demo-key (never print). `node scripts/smoke-deployed.mjs` verifies the public endpoint (add_item + check_item -> recalled). 50 tests green.
- CDK bootstrapped (CDKToolkit stack, tagged). `cd infra && npm run deploy` redeploys (build first is built in).

## Left
- packages/simulator backend: an agent loop (Bedrock Converse API with tool use, or the Anthropic SDK on Bedrock) that lists MCP tools via the SDK client, calls them, per-session turn limit, session household ID.
- Mocked Bedrock client for tests (scripted tool_use responses).

## Next step
Check Bedrock access: `MSYS_NO_PATHCONV=1 aws bedrock list-foundation-models --region us-east-1 --query "modelSummaries[?contains(modelId,'claude')].modelId"` and `aws bedrock list-inference-profiles`; record which Claude model IDs exist in BLOCKERS/docs. Then design src/agent.ts in packages/simulator.
