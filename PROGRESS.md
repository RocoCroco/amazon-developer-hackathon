# PROGRESS

_Last updated: 2026-10-03_

## Current task
None open in Phases 0-9. Remaining: human steps (below) and stretch S1-S3.

## Done (Phase 9)
- A (T9.1-T9.3), B (T9.4-T9.8), C (T9.9-T9.11), D (T9.12-T9.16): all deployed and verified
  (`npm run e2e:deployed`, 413 tests). The new demo story (misheard "Aitjunz" dresser, Mercer's ice cream +
  peanut allergy, simulated car-seat recall) was dry-run against the deployed system with real Claude.
- CPSC copy in the recall cache: 2026 loaded and fresh (cursor 2026-10-03); a full 2008+ local backfill was
  started (`scripts/backfill-cpsc-local.mjs`); if older years are missing, rerun it (idempotent).

## Next step
If continuing: stretch S1 (per-household OAuth) is the top remaining judge weakness (docs/judge-review.md #6).
Keep the CPSC copy fresh: if the daily CPSC sync from Lambda keeps failing (F19), run
`npm run build && node scripts/backfill-cpsc-local.mjs 2026-09-01` weekly before judging.

## Facts a fresh session needs
- Simulator: https://6aqlg4s33zg7tgjhoqsetxjqyi0pctry.lambda-url.us-east-1.on.aws/ (stack `RecallGuardianStack`).
- Deploy: `cd infra && npm run deploy`. Verify: `npm run e2e:deployed`. Live Claude tests: `npm run test:live`.
- After changing `packages/simulator/public/*`: `node scripts/embed-ui.mjs`. Screenshots:
  `node scripts/shoot-simulator.mjs <url> docs/images`.
- Edits with backslashes: use the Edit/Write tools, not shell heredocs or `node -e` strings (F7).
- `npm run lint` includes Prettier; run `npm run format` first.

## Human steps
docs/manual-checklist.md: voice check in Chrome/Edge (hands-free, misheard brand), Firefox and phone checks,
record the video (docs/video-script.md), flip repo public (T7.2), fill Devpost (docs/devpost-submission.md).
