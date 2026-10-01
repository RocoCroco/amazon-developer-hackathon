# TASKS

Work top to bottom. Mark `[x]` only when the "Done when" criterion is verified.
If a task is blocked, mark it `[!]`, write why in BLOCKERS.md, and continue with the next unblocked task.
Manual checks that need the human go in `docs/manual-checklist.md`, not in "Done when" (verify with scripts/Playwright instead).
Target: thin end-to-end slice (Phase 1) working by ~day 7 (Oct 8), then widen.

## Phase 0 — Foundations
- [x] T0.0 Read the Devpost rules and judging criteria (https://amazonappdev2026.devpost.com/ and its rules page). Record in `docs/rules.md`: required deliverables, judging criteria, whether real Alexa+ integration is required or a simulator is acceptable, eligibility, submission format. **Done when:** docs/rules.md exists; if findings contradict SPEC.md, add a BLOCKERS.md entry.
- [x] T0.1 Create repo structure (monorepo: `packages/mcp-server`, `packages/simulator`, `infra`), MIT license, README skeleton, .gitignore (must ignore `.env*`, `.aws`, credentials). Use the EXISTING GitHub repo (`origin` = RocoCroco/amazon-developer-hackathon) — do NOT create a new one; it stays PRIVATE until T7.2. **Done when:** pushed to GitHub, CI-free build passes locally.
- [x] T0.2 Tooling: TypeScript, lint, formatter, Vitest. **Done when:** `npm test` and `npm run lint` pass.
- [x] T0.3 Create BLOCKERS.md, FRICTION_LOG.md, FEEDBACK.md (per-tool product feedback), `docs/manual-checklist.md`. Add to BLOCKERS.md: Bedrock model access (human enabling in us-east-1; mock until then). **Done when:** files exist with templates.

## Phase 1 — Thin end-to-end slice (CPSC only) — by ~day 7
- [x] T1.1 Research and document (in `docs/data-sources.md`) the real CPSC, NHTSA (recalls + vPIC) and openFDA endpoints, parameters, date filters, limits, keys. Note explicitly which sources support "since date" queries (affects watcher design). **Done when:** each endpoint was called successfully from a script and a sample response saved as a test fixture.
- [ ] T1.2 Common `Recall` schema + CPSC adapter. **Done when:** unit tests pass on fixtures.
- [ ] T1.3 Basic deterministic matcher (brand alias + model + year normalization). **Done when:** unit tests pass on CPSC fixtures.
- [ ] T1.4 MCP server skeleton (official TS SDK, spec 2025-11-25+, stateless Streamable HTTP, JSON responses) with in-memory store and tools `add_item` + `check_item`. **Done when:** a scripted MCP SDK client connects over HTTP, lists tools, registers an item and checks it.
- [ ] T1.5 DynamoDB data layer (tests with mock or DynamoDB Local) replacing the in-memory store. Household IDs are unguessable (random, ≥128 bits). **Done when:** tests pass.
- [ ] T1.6 CDK stack in us-east-1 (Lambda + public HTTPS endpoint + DynamoDB on-demand), tagged `Project=recall-guardian`, shared demo key required on the MCP endpoint, Lambda reserved concurrency/throttling set. **Done when:** deployed and the scripted client works against the public URL.
- [ ] T1.7 Simulator backend, text mode: Claude on Bedrock (mocked until access is enabled; see BLOCKERS.md) as the assistant, connected to the deployed MCP server as a real MCP client; per-session turn limit. **Done when:** a scripted text conversation registers an item and checks it.
- [ ] T1.8 Minimal text web UI (transcript + inventory panel). **Done when:** typing in the browser registers and checks an item (Playwright).

## Phase 2 — Widen the data
- [ ] T2.1 NHTSA adapter (vehicles + car seats/equipment) + VIN decode. Car seat recall must be findable from brand + model. **Done when:** unit tests pass on fixtures.
- [ ] T2.2 openFDA adapter (food + drugs). **Done when:** unit tests pass on fixtures.
- [ ] T2.3 Recall cache with incremental fetch. For sources without "since date" (likely NHTSA), design per-item re-query or bulk files. **Done when:** tests prove no duplicate recalls and correct incremental behavior per source.

## Phase 3 — Matching (technical core)
- [ ] T3.1 Full normalization + fuzzy matching (brands, model numbers, years, date ranges). Test set of ≥50 item/recall pairs from real fixtures, including hard negatives (same brand, different model). **Done when:** precision ≥95% on the set, recall also reported, results in `docs/matcher-results.md`.
- [ ] T3.2 LLM confirmation via Bedrock returning {match, confidence, reason, clarifying_question}; cheapest suitable Claude model for dev (verify model IDs available in the account); results cached per item–recall pair. **Done when:** tests with mocked Bedrock pass, precision does not drop; one real call verified (or BLOCKERS.md entry if access is not yet enabled).
- [ ] T3.3 Clarifying-question flow when confidence is low. **Done when:** tests cover "unknown model", "ambiguous brand", "wrong year".

## Phase 4 — Full MCP tool set
- [ ] T4.1 `list_items`, `update_item`, `remove_item` (confirm before destructive actions). **Done when:** tool tests pass.
- [ ] T4.2 `check_household`, `get_alerts`, `get_remedy`, `resolve_alert`; `check_item` upgraded with the full matcher. **Done when:** tool tests pass.
- [ ] T4.3 Voice-first review of every tool response (SPEC §5). **Done when:** each tool has a test asserting a short spoken summary.
- [ ] T4.4 Daily watcher: EventBridge schedule → Lambda → alerts, deployed. **Done when:** a manual invocation of the deployed Lambda creates alerts from a seeded recall.
- [ ] T4.5 Cost check: `docs/costs.md`. **Done when:** estimate < $10/month at demo usage.

## Phase 5 — Alexa+ simulator, full
- [ ] T5.1 Voice: push-to-talk via Web Speech API recognition; spoken replies via Amazon Polly (neural voice, serverless, cached/limited usage); text fallback; alerts panel with polling of `get_alerts`. Clean, Alexa-like look. **Done when:** full demo story works by typing (Playwright); voice path verified by script where possible, rest in manual checklist.
- [ ] T5.2 Demo mode: seeded household + "simulate new recall" control + reset button. **Done when:** the SPEC §8 story runs start to finish 3 times in a row without errors (scripted).
- [ ] T5.3 Deploy simulator publicly (S3/CloudFront or Lambda). **Done when:** reachable via public URL, abuse limits (turn limit, throttling) in place.

## Phase 6 — Quality and submission material
- [ ] T6.1 End-to-end test of the demo story (automated where possible).
- [ ] T6.2 README: problem, stat, architecture diagram (Mermaid), setup, deploy, how to test, license.
- [ ] T6.3 Verify the 6% vs 50% CPSC figures against the original source and the claim "Amazon notifies customers about recalls of products bought on Amazon"; cite sources in README and `docs/sources.md`; fix SPEC/video script if wrong.
- [ ] T6.4 Finalize FRICTION_LOG.md and FEEDBACK.md.
- [ ] T6.5 Write `docs/video-script.md`: < 3 min English script following SPEC §8, with exact phrases to say to the simulator.
- [ ] T6.6 Write `docs/devpost-submission.md`: project description ready to paste.
- [ ] T6.7 Finish `docs/manual-checklist.md` (everything only the human can verify: MCP Inspector, voice in Chrome, Bedrock access, video recording, Devpost form).

## Phase 7 — Release
- [ ] T7.1 Final secret scan of the whole repo and git history (e.g. gitleaks or a manual regex scan); fix anything found. **Done when:** scan is clean.
- [ ] T7.2 Make the repo public (or share with the judging team: rules allow private-shared; see docs/rules.md) — **only after T7.1 and only right before submission.** Needs human go-ahead: write in BLOCKERS.md and leave `[!]` for the human to flip.

## Stretch (only when everything above is done)
- [ ] S1 OAuth 2.1 for households.
- [ ] S2 Photo of the product label → model number extraction.
- [ ] S3 Pet food recalls, if openFDA coverage allows.
