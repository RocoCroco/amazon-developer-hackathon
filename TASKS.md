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
- [x] T1.2 Common `Recall` schema + CPSC adapter. **Done when:** unit tests pass on fixtures.
- [x] T1.3 Basic deterministic matcher (brand alias + model + year normalization). **Done when:** unit tests pass on CPSC fixtures.
- [x] T1.4 MCP server skeleton (official TS SDK, spec 2025-11-25+, stateless Streamable HTTP, JSON responses) with in-memory store and tools `add_item` + `check_item`. **Done when:** a scripted MCP SDK client connects over HTTP, lists tools, registers an item and checks it.
- [x] T1.5 DynamoDB data layer (tests with mock or DynamoDB Local) replacing the in-memory store. Household IDs are unguessable (random, ≥128 bits). **Done when:** tests pass.
- [x] T1.6 CDK stack in us-east-1 (Lambda + public HTTPS endpoint + DynamoDB on-demand), tagged `Project=recall-guardian`, shared demo key required on the MCP endpoint, Lambda reserved concurrency/throttling set. **Done when:** deployed and the scripted client works against the public URL.
- [x] T1.7 Simulator backend, text mode: Claude on Bedrock (mocked until access is enabled; see BLOCKERS.md) as the assistant, connected to the deployed MCP server as a real MCP client; per-session turn limit. **Done when:** a scripted text conversation registers an item and checks it.
- [x] T1.8 Minimal text web UI (transcript + inventory panel). **Done when:** typing in the browser registers and checks an item (Playwright).

## Phase 2 — Widen the data
- [x] T2.1 NHTSA adapter (vehicles + car seats/equipment) + VIN decode. Car seat recall must be findable from brand + model. **Done when:** unit tests pass on fixtures.
- [x] T2.2 openFDA adapter (food + drugs). **Done when:** unit tests pass on fixtures.
- [x] T2.3 Recall cache with incremental fetch. For sources without "since date" (likely NHTSA), design per-item re-query or bulk files. **Done when:** tests prove no duplicate recalls and correct incremental behavior per source.

## Phase 3 — Matching (technical core)
- [x] T3.1 Full normalization + fuzzy matching (brands, model numbers, years, date ranges). Test set of ≥50 item/recall pairs from real fixtures, including hard negatives (same brand, different model). **Done when:** precision ≥95% on the set, recall also reported, results in `docs/matcher-results.md`.
- [x] T3.2 LLM confirmation via Bedrock returning {match, confidence, reason, clarifying_question}; cheapest suitable Claude model for dev (verify model IDs available in the account); results cached per item–recall pair. **Done when:** tests with mocked Bedrock pass, precision does not drop; one real call verified (or BLOCKERS.md entry if access is not yet enabled).
- [x] T3.3 Clarifying-question flow when confidence is low. **Done when:** tests cover "unknown model", "ambiguous brand", "wrong year".

## Phase 4 — Full MCP tool set
- [x] T4.1 `list_items`, `update_item`, `remove_item` (confirm before destructive actions). **Done when:** tool tests pass.
- [x] T4.2 `check_household`, `get_alerts`, `get_remedy`, `resolve_alert`; `check_item` upgraded with the full matcher. **Done when:** tool tests pass.
- [x] T4.3 Voice-first review of every tool response (SPEC §5). **Done when:** each tool has a test asserting a short spoken summary.
- [x] T4.4 Daily watcher: EventBridge schedule → Lambda → alerts, deployed. **Done when:** a manual invocation of the deployed Lambda creates alerts from a seeded recall.
- [x] T4.5 Cost check: `docs/costs.md`. **Done when:** estimate < $10/month at demo usage.

## Phase 5 — Alexa+ simulator, full
- [x] T5.1 Voice: push-to-talk via Web Speech API recognition; spoken replies via Amazon Polly (neural voice, serverless, cached/limited usage); text fallback; alerts panel with polling of `get_alerts`. Clean, Alexa-like look. **Done when:** full demo story works by typing (Playwright); voice path verified by script where possible, rest in manual checklist.
- [x] T5.2 Demo mode: seeded household + "simulate new recall" control + reset button. **Done when:** the SPEC §8 story runs start to finish 3 times in a row without errors (scripted).
- [x] T5.3 Deploy simulator publicly (S3/CloudFront or Lambda). **Done when:** reachable via public URL, abuse limits (turn limit, throttling) in place.

## Phase 6 — Quality and submission material
- [x] T6.1 End-to-end test of the demo story (automated where possible).
- [x] T6.2 README: problem, stat, architecture diagram (Mermaid), setup, deploy, how to test, license.
- [x] T6.3 Verify the 6% vs 50% CPSC figures against the original source and the claim "Amazon notifies customers about recalls of products bought on Amazon"; cite sources in README and `docs/sources.md`; fix SPEC/video script if wrong.
- [x] T6.4 Finalize FRICTION_LOG.md and FEEDBACK.md.
- [x] T6.5 Write `docs/video-script.md`: < 3 min English script following SPEC §8, with exact phrases to say to the simulator.
- [x] T6.6 Write `docs/devpost-submission.md`: project description ready to paste.
- [x] T6.7 Finish `docs/manual-checklist.md` (everything only the human can verify: MCP Inspector, voice in Chrome, Bedrock access, video recording, Devpost form).

## Phase 10 — Second test feedback (do before T7.2 and the stretch items)
- [x] T10.1 Speech accuracy: recognition explicitly en-US (never the browser/Windows language); Amazon Transcribe streaming (presigned WebSocket from the simulator Lambda, custom vocabulary built from recall brand names, spending caps) as the main engine, browser engine as fallback; Alexa reads noisy transcripts charitably and asks a short clarifying question instead of guessing; cost in docs/costs.md. **Done when:** event-stream codec and presign unit-tested, browser test with a stubbed Transcribe socket passes, live check against Transcribe passes.
- [x] T10.2 Follow-up mode: the wake word only starts a conversation; after each reply the page keeps listening (ring lit) for ~8 s; the conversation ends on silence or "thanks / that's all / stop", then back to waiting for "Alexa". **Done when:** browser tests cover follow-up, silence end and "thanks" end.
- [x] T10.3 Photo: no zoom, no upscaling, no blurred copy; edges feathered (CSS mask) into a solid background color sampled from the photo. **Done when:** screenshots reviewed at several sizes.
- [x] T10.4 Gear icon instead of the chevron next to the logo.
- [x] T10.5 Messaging-app bubbles: rounded with a small tail, subtle spring entrance, typing indicator while Alexa thinks, Alexa's words revealed in sync with the voice, the user's words appearing live while talking. **Done when:** browser tests updated; deploy and give the human the URL.

## Phase 11 — Submission polish
- [!] T11.1 Open Source mini challenge: the rules ask for a separate open-source project (or a contribution to another public repo), not just this repo made public. Options in docs/challenges.md (browser client for Transcribe streaming; US recall data normalizer; MCP-on-Lambda example). The human chose an open recall standard: design in docs/open-recall-format.md; built outside this repo (spec, schema, 7 converters, checker, CLI, 75 tests); the human uploads it as a new public repo and posts the schema.org #3229 comment (BLOCKERS B4).
- [x] T11.2 Documentation per challenge and architecture (docs/challenges.md, docs/architecture.md, docs/rules.md with the exact wording).
- [x] T11.3 Fixes from the third voice test: a confirmed brand always reaches the server (next_step), no extra questions after "I don't know", voice picker in the settings, Claude second opinion wired into the deployed server.

## Phase 7 — Release
- [x] T7.1 Final secret scan of the whole repo and git history (e.g. gitleaks or a manual regex scan); fix anything found. **Done when:** scan is clean.
- [ ] T7.2 Make the repo public (or share with the judging team: rules allow private-shared; see docs/rules.md) — **only after T7.1 and only right before submission.** Needs human go-ahead: write in BLOCKERS.md and leave `[!]` for the human to flip.

## Stretch (only when everything above is done)
- [ ] S1 OAuth 2.1 for households.
- [ ] S2 Photo of the product label → model number extraction.
- [ ] S3 Pet food recalls, if openFDA coverage allows.

## Phase 8 — Simulator redesign (from design/mockups, assets in design/assets)
- [x] T8.1 Image pipeline: verify the four Echo photos align (measured: lit photos are 1 px off vertically; fix it), convert to WebP at two sizes, copy the logo. **Done when:** `scripts/build-images.mjs` regenerates `packages/simulator/public/img/*`, each file is small, and a check shows the aligned layers differ only where the ring is.
- [x] T8.2 Carry a product image through the data (CPSC `Images`) to alerts and the MCP tool details. **Done when:** unit tests pass.
- [x] T8.3 New UI: full-screen photo, animated light ring (idle / listening / thinking / speaking synced with the Polly audio), floating fading bubbles, glass Recall Guardian panel with status dots and expandable recalled items, input bar + mic (Chrome/Edge; clear message elsewhere), discreet demo menu behind the chevron, responsive for phones. **Done when:** it renders correctly on desktop and phone viewports (screenshots reviewed).
- [x] T8.4 Serve images from the Lambda/hosting (binary-safe, cache headers, size within limits). **Done when:** deployed pages load every image.
- [x] T8.5 Update the browser tests for the new UI (typed story, voice stub, ring states, panel, mobile viewport). **Done when:** `npm test` and `npm run e2e:deployed` pass.
- [x] T8.6 Deploy and give the human the URL to review.

## Phase 9 — Feedback after the human's test (priority order; deploy after A, B and C and share the URL)
### A. Bugs
- [x] T9.1 Live panel update: when the user mentions a recalled item, the panel item turns red and expands smoothly (model, CPSC product photo, one-sentence hazard) right after the reply. **Done when:** a browser test registers a recalled item in one turn and sees it red and expanded with the photo.
- [x] T9.2 Chat scrolls: older messages stay reachable (scrollable transcript, fade only at the top edge). **Done when:** a browser test scrolls up to the first message.
- [x] T9.3 No greeting on load (a real Alexa never speaks first). **Done when:** the transcript is empty on load (test). Then deploy A and share the URL.
### B. Visual polish (compare design/screenshots with design/mockups)
- [x] T9.4 Remove the cut-off bubble shadow; match the mockup bubbles.
- [x] T9.5 Background photo without zoom/upscaling (never wider than its natural 1672 px; letterbox filled with a blurred copy); higher-quality WebP.
- [x] T9.6 Cleaner glass panel (blur, subtle border, soft shadow), logo/title like the mockups.
- [x] T9.7 Settings button that opens a pop-up dialog (demo actions, speak replies, hands-free).
- [x] T9.8 Thinking = soft breathing blue glow over the ring of the lit photo (no photo swap); all ring transitions soft. **Done when:** screenshots reviewed at desktop + phone, browser tests updated and green. Then deploy B and share the URL.
### C. Voice
- [x] T9.9 Phonetic brand matching in the MCP server: heard brand compared by sound with brands in the recall data; Alexa confirms with spelling ("Do you mean Aitjunz, A-I-T-J-U-N-Z?"); the user can spell letter by letter. **Done when:** unit tests with realistic misrecognitions pass.
- [x] T9.10 Hands-free mode: continuous listening after one mic permission, wake word "Alexa", silence detection ends the request, paused while Alexa speaks, auto-restart when Chrome stops recognition; tap-to-talk fallback; clear message without speech recognition. **Done when:** browser tests with a stubbed recognizer pass.
- [x] T9.11 Persona: normal but limited Alexa; off-topic requests get a brief polite answer plus a reminder that this is a Recall Guardian simulation. **Done when:** prompt updated and tested (mock brain + one live check). Then deploy C and share the URL.
### D. Polish to win
- [x] T9.12 Food and medicine recalls (openFDA) live lookup + matching against family allergies (undeclared-allergen recalls); food recall moment in the demo if it fits in 3 minutes.
- [x] T9.13 Harder hand-checked evaluation set (hard negatives, misspellings, vague descriptions, partial model numbers); honest numbers and failure modes in docs/matcher-results.md.
- [x] T9.14 Clean up PROGRESS.md.
- [x] T9.15 Strict judge review (docs/rules.md criteria) → docs/judge-review.md, weaknesses ranked by score impact; fix the most important ones.
- [x] T9.16 Resilience to CPSC outages (seen 2026-10-03: the API answered HTTP 503 for hours): report "could not reach" instead of "no recalls" (done with T9.1), and backfill recent CPSC recalls into the DynamoDB recall cache so lookups keep working while CPSC is down.
