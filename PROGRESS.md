# PROGRESS

_Last updated: 2026-10-03_

## Current task
Phase 11. T11.1 Open Source: the human creates and uploads the repo themselves. The project lives OUTSIDE this repo at C:/Users/Roco/Documents/open-recall-format (not committed here). Done there: types, JSON Schema, JSON-LD context, vocab/*.json, converters for 7 sources (CPSC, NHTSA API + flat file, openFDA, Canada RSA, EU Safety Gate, RappelConso, UK OPSS), checker, CLI (convert/fetch/validate/check), examples, 75 tests green; live fetch from every source validated; whole Canadian file (34,168) valid. Left: spec/open-recall-format-0.1.md, spec/mappings.md, docs/schema-org-3229.md, README, LICENSE (Apache-2.0), spec/LICENSE (CC BY 4.0), NOTICE, fixtures/README (data licences), CONTRIBUTING, CHANGELOG, and the guide for the human at C:/Users/Roco/Documents/open-recall-format-GUIDE.md. Also deploy the NHTSA day-first date fix (commit 3e21b4b) with npm run deploy -w infra.

## Done recently
- docs/impact.md (numbers for the pitch, sources in docs/sources.md section 3); text credit "Built on AWS · Made for Alexa+" under the panel title, deployed.
- Third voice test fixes (confirmed brands applied, no insisting, voice picker), second opinion live in the MCP server.
- docs/architecture.md, docs/challenges.md, docs/rules.md (exact wording: edited promotional videos are fine if
  they show real footage of the project working; no unlicensed music or third-party trademarks).

## Next step
In C:/Users/Roco/Documents/open-recall-format: write spec/open-recall-format-0.1.md (normative rules for selectors and the checker, matching src/check.ts), then README and licences; run npx vitest run there; then write the GUIDE outside it.

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
