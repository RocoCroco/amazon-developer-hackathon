# PROGRESS

_Last updated: 2026-10-03_

## Current task
Phase 11. T11.1 Open Source: the human chose an open recall data standard. Research and design done: docs/open-recall-format.md. Creating a public repo needs the human (B4).

## Done recently
- docs/impact.md (numbers for the pitch, sources in docs/sources.md section 3); text credit "Built on AWS · Made for Alexa+" under the panel title, deployed.
- Third voice test fixes (confirmed brands applied, no insisting, voice picker), second opinion live in the MCP server.
- docs/architecture.md, docs/challenges.md, docs/rules.md (exact wording: edited promotional videos are fine if
  they show real footage of the project working; no unlicensed music or third-party trademarks).

## Next step
Wait for the human on B4 (public repo for the Open Recall Format). Meanwhile, if continuing: draft `schema/orf.schema.json` (v0.1) and the CPSC normalizer in a local, unpublished folder next to this repo, following docs/open-recall-format.md section 3.

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
