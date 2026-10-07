# BLOCKERS

## B1 - Bedrock model access - RESOLVED 2026-10-01
- The human submitted the Anthropic use-case form. Verified: `us.anthropic.claude-haiku-4-5-20251001-v1:0` answers; `npm run test:live` passes (real Claude conversation against the deployed MCP server, and the three second-opinion verdicts).
- `us.anthropic.claude-sonnet-5-5` was "not available for this account" earlier (not retested; Haiku 4.5 is the default and what docs/costs.md assumes).
- T1.7 and T3.2 are marked done.

## B2 - Repo visibility (blocks: nothing until the end; see T7.2)
- Decision (human): keep the repo PRIVATE until right before submission, then make it public after a full secret scan (T7.1 then T7.2). docs/rules.md: a private repo shared with the judging team is also allowed.
- T7.2 stays `[!]` for the human to flip.

## B3 - Lambda concurrency quota is 10 (non-blocking hardening)
- The human requested an increase (Service Quotas case, desired 1000; status CASE_OPENED on 2026-10-01). Account limit is still 10 (`aws lambda get-account-settings`).
- Check occasionally: `aws lambda get-account-settings --region us-east-1 --query AccountLimit` and `aws service-quotas list-requested-service-quota-change-history-by-quota --service-code lambda --quota-code L-B99A9384 --region us-east-1`.
- When approved: set reserved concurrency in infra/lib/recall-guardian-stack.ts (MCP function, e.g. 20; simulator function; keep the watcher at 1), redeploy, add an infra test, note it in FRICTION_LOG F5.

## B4 - Open Source mini challenge needs a separate project (2026-10-03) - RESOLVED 2026-10-04: published at https://github.com/RocoCroco/open-recall-format
- What: the rules (docs/rules.md) ask for "a new, additional open-source project or contribute to an existing public repository during the hackathon window". Making this repo public does not qualify.
- Why it needs you: it is a product choice (which project, under whose GitHub account, published publicly).
- Options (docs/challenges.md): (1) a small browser client for Amazon Transcribe streaming, (2) a US recall data normalizer (CPSC, NHTSA, openFDA), (3) a contribution to another repo (e.g. an MCP-on-Lambda example).
- Update 2026-10-03: the human chose an open recall data standard. Research and design: docs/open-recall-format.md ("Open Recall Format"). Still needed from the human: OK to create a **public** GitHub repository (which account, name "open-recall-format"?), and OK on the licences (spec CC BY 4.0, code Apache-2.0). Until then the work happens locally, unpublished.
- Update 2026-10-03 (later): the human will create the repository and upload it themselves. Everything is ready outside this repo, with a step-by-step guide (licences explained, git commands, the comment for schema.org #3229, Devpost text) in `../open-recall-format-GUIDE.md` (next to this repository, not in it). Waiting only on the upload.
- Blocks: T11.1 only.
