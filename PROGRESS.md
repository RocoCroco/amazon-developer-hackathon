# PROGRESS

_Last updated: 2026-10-03_

## Current task
None open in Phases 0-10. Remaining: human steps (below) and stretch S1-S3.

## Done (Phase 10, second test feedback)
- T10.1 speech: en-US forced; Amazon Transcribe streaming (presigned WebSocket from the simulator Lambda, our own
  event-stream codec, custom vocabulary "recall-guardian-brands" built by scripts/build-vocabulary.mjs, daily cap 400
  streams) with the browser recognizer as fallback; charitable reading of noisy transcripts in the prompt; costs.
- T10.2 follow-up mode (wake word starts a conversation; 8 s follow-up; "thanks"/silence ends it).
- T10.3 photo edges feathered into a colour sampled from the photo; T10.4 gear icon; T10.5 bubbles with tails,
  spring entrance, typing dots, words revealed with the voice, live user words.
- CPSC cache: full local backfill done (CPSC rejects recall-date queries before mid-2011).

## Next step
If continuing: stretch S1 (per-household OAuth). Keep the CPSC copy fresh before judging if the daily sync from
Lambda keeps failing: `npm run build && node scripts/backfill-cpsc-local.mjs 2026-09-01`. After the copy grows,
`node scripts/build-vocabulary.mjs` refreshes the Transcribe vocabulary.

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
