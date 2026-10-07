# CLAUDE.md — Working rules

You are building the project described in docs/process/SPEC.md, following docs/process/TASKS.md (working files of the build live in docs/process/). The human is often away. Work autonomously.

## Work loop
0. **First thing every session: read docs/process/PROGRESS.md.** Resume exactly from its "Next step".
1. Read docs/process/SPEC.md, TASKS.md, BLOCKERS.md and the last entries of FRICTION_LOG.md at the start of every session.
2. Take the first unchecked task. Plan briefly, implement, write/run tests, fix until green.
3. Mark the task `[x]` in docs/process/TASKS.md and commit with a clear message (`T3.2: DynamoDB data layer`). Push to GitHub after each task.
4. Continue with the next task. **Do not stop** until every task is done or all remaining tasks are blocked.

## PROGRESS.md (docs/process/) — session handoff
- Maintain docs/process/PROGRESS.md with: **Current task**, **Done** (within this task), **Left** (within this task), and **Next step** (one exact, actionable step — e.g. "Run `npm test -w packages/mcp-server`; fix failing test in `matcher.test.ts`").
- Update it frequently during every task: after each meaningful sub-step, before any long-running command, and before every commit. Assume the session can end at any moment.
- It must be enough for a fresh session with no memory to resume exactly where the previous one stopped. Never put secrets in it.

## When you need the human
- Need a secret, an account action, a payment, or a product decision? Write it in docs/process/BLOCKERS.md (what, why, which tasks it blocks), mark the task `[!]`, use a mock/placeholder if possible, and **move on** to the next unblocked task.
- Never stop just to ask a question that can wait.

## Quality
- Never mark a task done if tests fail. Never delete or skip tests to make them pass.
- Keep code simple and readable. Small modules, typed interfaces.
- All code, comments, docs and commit messages in **English**.
- Verify external APIs against official docs; don't invent endpoints or fields.

## Hackathon requirements (must hold)
- MCP spec 2025-11-25 or later, Streamable HTTP transport, official TypeScript SDK.
- The repo must genuinely use MCP in the code, not just mention it.
- Log every significant problem in FRICTION_LOG.md: what you tried, what you expected, what happened, how you solved it.
- Log tool/SDK impressions in FEEDBACK.md as you go.

## Secrets — strict
- Never print, log, commit or copy credentials. AWS credentials come from the local AWS CLI profile; never read the credentials file.
- `.env*` files are git-ignored. Check `git diff --staged` for secrets before every commit.

## AWS — cost and safety rules
- Region: **us-east-1** only.
- Serverless only: Lambda, DynamoDB on-demand, EventBridge, S3/CloudFront or similar, Bedrock. **Never** create EC2, NAT gateways, RDS, load balancers, OpenSearch, or anything with an hourly cost.
- Tag everything `Project=recall-guardian`. Only modify or delete resources with that tag or created by this project's CDK stack. Never touch anything else in the account.
- Set Lambda timeouts and sensible memory. Cache external API calls.
- Bedrock: use the cheapest suitable Claude model for development and tests; mock Bedrock in unit tests. Verify model IDs available in the account before using them.
- Keep total cloud spend minimal; the budget is small and credits are limited.

## Windows environment
- This machine runs native Windows (no WSL). Use cross-platform npm scripts; avoid bash-only syntax in package.json scripts.
