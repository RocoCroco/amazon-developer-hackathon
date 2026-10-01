# BLOCKERS

## B1 - Bedrock model access (blocks: T3.2 real call, T1.7 real Claude)
- What: human enables Bedrock Claude model access in us-east-1 (said they would do it on 2026-10-01).
- Why: needed for the LLM confirmation step and the simulator brain.
- Workaround: Bedrock is mocked until access is confirmed; verify available model IDs in the account first.

## B2 - Repo visibility / judge sharing (blocks: T7.2)
- What: human decides: make public, or keep private and share with the judging team (docs/rules.md). Mini challenges may need public.
- Why: submission requirement.
