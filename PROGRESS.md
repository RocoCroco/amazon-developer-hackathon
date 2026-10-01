# PROGRESS

_Last updated: 2026-10-01_

## Current task
T6.1 - End-to-end test of the demo story (automated where possible). Much of it exists already: packages/simulator/src/demo-story.test.ts (SPEC s8 x3, in-process), scripts/verify-simulator.mjs (deployed, real Claude + Polly + watcher), scripts/verify-watcher.mjs, scripts/smoke-deployed.mjs. Remaining: wire an `npm run e2e` that runs the deployed checks together + document; maybe a Playwright run of the story with the REAL brain against the deployed URL (verify-simulator covers the key moments).

## Done
- Phases 0-5. DEPLOYED stack RecallGuardianStack (us-east-1): MCP Lambda (public URL + demo key), watcher Lambda (daily 07:00 UTC), simulator Lambda (public URL: UI + chat API; DynamoDB sessions; daily caps 600 turns / 120k speech chars; Polly; Bedrock Haiku 4.5; demo buttons invoke the watcher), DynamoDB table. 337 tests green, lint clean. Public simulator URL: stack output SimulatorUrl.
- B1 resolved. B3 (Lambda concurrency quota 10; human requested increase, case open): check with `aws lambda get-account-settings`; when raised, set reserved concurrency (MCP, simulator) in infra and redeploy.
- GitHub push was failing (network) at last attempt: run `git push origin main` and make sure the branch is up to date.

## Left
- Phase 6: T6.1 e2e wrap-up, T6.2 README (problem, stat, Mermaid diagram, setup, deploy, test, license), T6.3 verify 6% vs 50% and the Amazon claim with primary sources (docs/sources.md), T6.4 finalize FRICTION/FEEDBACK, T6.5 docs/video-script.md, T6.6 docs/devpost-submission.md, T6.7 finish docs/manual-checklist.md.
- Phase 7: T7.1 secret scan (repo + history), T7.2 make public / share with judges (human, stays [!]).
- Stretch S1-S3 only if everything else is done.

## Next step
Push (retry), then do T6.3 first (it can change the pitch wording used everywhere): search the CPSC 2017 workshop source for the 6%/50% figures and Amazon's recall-notification policy; write docs/sources.md with exact citations and adjust SPEC/README wording if the numbers differ.
