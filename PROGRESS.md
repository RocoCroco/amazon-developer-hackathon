# PROGRESS

_Last updated: 2026-10-03_

## Current task
Phase 9, group D: T9.15 strict judge review (docs/judge-review.md), then fix the top weaknesses. T9.12 is open
only for its demo part (food/allergy moment in docs/video-script.md, done inside T9.15). T9.16 is waiting on the
CPSC backfill run on the deployed watcher.

## Done (Phase 9)
- A (T9.1-T9.3) live panel update, scrollable chat, no greeting; B (T9.4-T9.8) mockup-faithful UI; C (T9.9-T9.11)
  phonetic brand matching in the MCP server, hands-free wake word, limited-Alexa persona. All deployed.
- T9.12 code: live openFDA lookup, family allergies (`update_allergies`, `recent_allergen_recalls`, allergy notes),
  allergy alerts shown red and announced in the simulator.
- T9.13 blind challenge set: docs/matcher-results.md ("Challenge set").
- T9.16 code: honest `source_unavailable`, product-word cache index, CPSC backfill (recall-date windows, split on
  failure), cache covers CPSC outages.

## Left
- T9.15 judge review + fixes; T9.12 demo moment; T9.16: confirm the backfill finished (watcher logs: a line with
  `"skippedDays"`), then live-check a CPSC lookup while CPSC is down (or at least that the cache answers).
- Deploy after D and give the human the URL.

## Next step
Check the local backfill finished (`node scripts/backfill-cpsc-local.mjs 2008-01-01` prints a JSON line; rerun it if not, it is idempotent and sets the CPSC cursor). Then re-run the demo dry run (docs/video-script.md lines) against the deployed simulator and fix what differs; then mark T9.12, T9.15, T9.16 done.



## Facts a fresh session needs
- Deployed URLs: stack outputs of `RecallGuardianStack` (SimulatorUrl, McpUrl). Simulator:
  https://6aqlg4s33zg7tgjhoqsetxjqyi0pctry.lambda-url.us-east-1.on.aws/
- Deploy: `cd infra && npm run deploy`. Verify: `npm run e2e:deployed`. Live Claude tests: `npm run test:live`.
- After changing `packages/simulator/public/*`: `node scripts/embed-ui.mjs` (a test checks it). Images:
  `node scripts/build-images.mjs`. Screenshots: `node scripts/shoot-simulator.mjs <url> docs/images`.
- Edits with backslashes: use the Edit/Write tools, not shell heredocs or `node -e` strings (F7).
- `npm run lint` includes Prettier; run `npm run format` first.

## Human steps
docs/manual-checklist.md: voice check in Chrome (now also hands-free "Alexa"), record video, flip repo public
(T7.2), fill Devpost.
