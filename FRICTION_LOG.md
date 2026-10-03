# FRICTION LOG

Format: what I tried / what I expected / what happened / how I solved it.

## F1 - Vitest 5 fails on Windows: "Cannot find native binding" (2026-10-01)
- Tried: `npm i -D vitest` (v5, bundled with Vite 8 / rolldown) on native Windows 11, then `npm test`.
- Expected: tests run.
- Happened: startup error "Cannot find native binding ... npm has a bug related to optional dependencies". A clean reinstall did not help. The real cause was hidden by that message: loading `rolldown-binding.win32-x64-msvc.node` directly gave "An Application Control policy has blocked this file." (Windows Application Control blocks unsigned native .node files on this machine.) The misleading npm-bug message cost several minutes.
- Solved: use Vitest 3 (Vite 7, esbuild, which runs here) and override rollup with the pure-WASM `@rollup/wasm-node` via `overrides` in root package.json. Did not attempt to bypass the policy.
- Consequence: avoid dependencies with unsigned native addons (rolldown, rollup native, swc) in this repo; check any new tool with a quick run.

## F2 - NHTSA equipment/car-seat API endpoints don't exist (2026-10-01)
- Tried: `api.nhtsa.gov/recalls/recallsByEquipment?make=graco` and `/products/equipment/...` by analogy with the vehicle endpoints.
- Expected: car seat recalls as JSON.
- Happened: HTTP 403 `{"message":"Missing Authentication Token"}` (API Gateway's answer for unknown routes, which suggests an auth problem when it isn't one). nhtsa.gov docs pages return 403 to automated fetches too.
- Solved: found via search that child seats/equipment/tires are in the daily bulk flat file `static.nhtsa.gov/odi/ffdd/rcl/`, verified it (462 child-seat rows). Documented in docs/data-sources.md.

## F3 - CPSC `Title=` filter is silently ignored (2026-10-01)
- Tried: `Recall?format=json&Title=Govee` (the docs page lists `Title` as a parameter) to look up recalls by brand.
- Expected: recalls whose title contains "Govee".
- Happened: HTTP 200 with ALL 10,027 recalls (27 MB). No error, no warning. `ProductName=Govee` works and returns 1 recall.
- Solved: provider uses `ProductName` (substring search) for brand and item name, caches per term and caps results; a test asserts `Title=` is never used.

## F4 - Git Bash rewrites SSM parameter names (2026-10-01)
- Tried: `aws ssm put-parameter --name /recall-guardian/demo-key ...` from Git Bash on Windows.
- Expected: parameter created.
- Happened: `Parameter name must be a fully qualified name`. MSYS path conversion turned `/recall-guardian/demo-key` into `C:/Program Files/Git/recall-guardian/demo-key`.
- Solved: `export MSYS_NO_PATHCONV=1` (scripts/smoke-deployed.mjs sets it for child processes). Lesson: any AWS CLI argument starting with `/` needs this on Windows Git Bash.

## F5 - Lambda reserved concurrency impossible on this account (2026-10-01)
- Tried: plan to set reserved concurrency on the MCP Lambda as a cost/abuse throttle (Function URLs have no built-in throttling).
- Expected: a per-function cap.
- Happened: `aws lambda get-account-settings` shows ConcurrentExecutions=10 and UnreservedConcurrentExecutions=10. AWS requires >=10 unreserved, so no reservation is possible; the account-wide cap of 10 is also shared by every future function (watcher included).
- Solved (for now): rely on the demo key (401 for others), 30 s timeout, 512 MB, and turn limits in the simulator. Asked the human to request a Lambda concurrency quota increase (BLOCKERS B3, non-blocking).

## F6 - Bedrock access flipped from working to "use case details not submitted" (2026-10-01)
- Tried: Converse with Haiku 4.5 and Sonnet 4.6 (worked), then again ~minutes later from the SDK and the CLI.
- Expected: same result.
- Happened: `ResourceNotFoundException: Model use case details have not been submitted for this account ... try again in 15 minutes.` for every Anthropic model. Sonnet 5.5 earlier said "not available for this account" (AccessDenied) - a different, less actionable message. `list-foundation-models` shows models as ACTIVE regardless of whether the account can invoke them.
- Solved: not solved from our side (account/console action). Tests use a scripted LLM; live test is opt-in (`npm run test:live`). Logged in BLOCKERS B1.

## F7 - Backslashes lost when generating source through shell snippets (2026-10-01)
- Tried: patching a regex-heavy TypeScript file with `node` scripts written via bash heredocs/`node -e` (first as a JS template literal, then as String.raw).
- Expected: regex source preserved byte for byte.
- Happened: `\b` became a literal backspace character (code 8) and `\s`, `\.`, `\d` lost their backslash, so a regex silently matched nothing (no error, invisible in the editor). Edit-tool matching against the displayed text failed for the same reason.
- Solved: write regex-bearing code only with the file Write/Edit tools; to repair, rebuilt the line with `String.fromCharCode(92)` and verified by char codes. Added a unit test per regex (extractDateRange) so this class of bug fails loudly.

## F8 - openFDA records with recall_number "N/A" collapsed unrelated recalls (2026-10-01)
- Tried: grouping per-product openFDA records by `recall_number` (fixtures looked fine) and syncing the real feeds into one cache.
- Expected: every recall gets its own id.
- Happened: the live sync reported 69 "added" for 70 fetched. Some records have `recall_number: "N/A"` in BOTH the food and drug endpoints (a mayonnaise packet and a nystatin cream shared the id `fda:N/A`), so unrelated recalls were merged and silently overwritten.
- Solved: `recallKey()` falls back to `event_id`, then to a content hash; regression test with the real shape. Found only because the opt-in live test (`npm run test:live`) runs against real data; the fixtures alone did not show it.

## F9 - Hand-written labels agreed with the matcher too easily (2026-10-01)
- Tried: a 69-item hand-labeled set over a 1,313-recall real corpus to measure matcher precision.
- Expected: labels would be an independent yardstick.
- Happened: the first run scored 90.6% precision; reviewing disagreements, 3 were wrong labels (e.g. a grill-brush model listed in two recalls, tire recalls that need a production year) and 3 were real over-claims. Because I fixed labels while looking at matcher output, the hand-labeled 100% is optimistic. A second, generated set (432 items, 567k pairs, expectations from a coverage policy over the structured fields) found four more real bugs the hand set had missed (production window applied to vehicles, "F-150" matching "F-150 Lightning", filler words in brand names, model-year vs made-year for seats).
- Solved: both sets stay in the test suite, results and the correction history are in docs/matcher-results.md, and the doc says which number is independent.

## F10 - check_item could not find child-seat or vehicle recalls in production (2026-10-01)
- Tried: designing the demo story ("a hand-me-down car seat") and asking which data check_item really uses in the deployed Lambda.
- Expected: all three official sources reachable from the tools (the unit tests were green and the heater demo worked).
- Happened: the Lambda's provider only queried CPSC live. Child seats and equipment live in NHTSA's flat file, which only the daily watcher reads, and only for the last 14 days; vehicles need a live NHTSA lookup. A "Graco SnugRide 2012" would have answered "no recalls" for a seat that has a real 2014 recall. Everything was tested with static fixtures, which hid it.
- Solved: `CompositeRecallProvider` (live CPSC + live NHTSA vehicle lookup + the watcher's cache) with per-source failure isolation, a one-time child-seat backfill (`{"backfill":true}` event on the watcher, 71 recalls), and production regression checks in `scripts/smoke-deployed.mjs` (seat via the cache, vehicle via live NHTSA). Lesson: smoke-test the deployed system with a case per data source, not only the happiest one.
- Still not covered in production: food/drug older than the watcher's first 14-day window, and equipment/tire recalls older than that (the cache only holds what the watcher synced). Listed in docs/data-sources.md.

(F6 update) Resolved 2026-10-01 after the human submitted the Anthropic use-case form in the Bedrock console: calls succeeded within ~15 minutes. The earlier brief success was probably a propagation window of a partially processed request.

## F11 - Headless Chromium's own SpeechRecognition beat my test stub (2026-10-01)
- Tried: Playwright test that stubs `window.webkitSpeechRecognition` to simulate push-to-talk, and a second test that removes it to simulate an unsupported browser.
- Expected: the stub is used; removing the prefixed name means "unsupported".
- Happened: the push-to-talk test timed out and the "no recognizer" test saw an enabled mic. The page uses `window.SpeechRecognition || window.webkitSpeechRecognition`, and Chromium defines the unprefixed `SpeechRecognition` itself.
- Solved: the stub assigns both names; the unsupported case sets both to `undefined`. Both paths are now tested (voice.e2e.test.ts).

## F12 - Reading PDFs for primary sources (2026-10-01)
- Tried: verify the "6% vs 50%" statistic from the CPSC workshop report and transcript instead of trusting search summaries.
- Expected: WebFetch returns the text.
- Happened: the tool reported the PDFs as binary and saved them to disk; the PDF page renderer needs poppler, which is not installed on this machine.
- Solved: a 20-line script with `pdfjs-dist` (pure JS) extracted the text; the quotes are in docs/sources.md. It also revealed what the summaries left out: the 6% is consumer-level only, the overall correction rate is 65%.

## F13 - The panel stayed green for a recalled item (2026-10-03)
- Tried: the human registered a recalled product by voice ("we got a ... dresser, model ...").
- Expected: the household panel turns red in the same turn.
- Happened: it stayed green. `add_item` / `update_item` only saved the item; an alert existed only after a separate `check_item`, which the model did not always call.
- Solved: saving an item with brand and model (or year) now runs the same check and records the alert in the same tool call (one MCP round trip instead of two). The UI unfolds the item with photo and hazard right after the reply.

## F14 - CPSC API down: an empty answer looked like "no recalls" (2026-10-03)
- Tried: a live check of the human's dresser example against the deployed stack.
- Expected: either the recall or an honest "I can't check right now".
- Happened: saferproducts.gov answered HTTP 503 ("Page Unavailable") for every query; the composite provider swallowed the error by design, so Alexa said "no recalls found", a dangerous answer for a safety product.
- Solved: providers now report which sources were unreachable; check_item / add_item / check_household answer `source_unavailable` ("I couldn't reach the CPSC recall database just now...") and never call an item clear in that case. Follow-up T9.16: backfill CPSC into the recall cache.

## F15 - Mixed CRLF/LF line endings broke scripted edits (2026-10-03)
- Tried: string replacements in node scripts after a `git stash` / `stash pop`.
- Expected: matches.
- Happened: with `core.autocrlf=true`, Git rewrote touched files with CRLF; search strings with `\n` no longer matched, and one edit silently did nothing (String.replace does not fail on a miss).
- Solved: `.gitattributes` with `eol=lf`, all tracked text files normalized to LF, and the edit helper now throws when a search string is missing.

## F16 - "Aitjunz" could never be matched, even when spelled right (2026-10-03)
- Tried: tests for phonetic brand matching against the real CPSC record of the human's example (recall 10998, Aitjunz 8-drawer dressers).
- Expected: the recall lists "Aitjunz" as a brand and "LDQMFJ8D-BK" as a model.
- Happened: brands were ["Yuyitop", "LDQMFJ8D-BR,", ...]: the recalling firm is not the brand on the product, and the quoted SKUs ("SKU "LDQMFJ8D-BR," ... is printed on the packaging") were read as brand names because the sentence says "printed"; the models list was empty.
- Solved: quoted codes (letters + digits, no spaces) are never brands and become models; the sold brand is taken from the product name when the title agrees ("Yuyitop Recalls Aitjunz 8-Drawer Dressers"). The 1,313-recall evaluation still scores the same.

## F17 - Empty model answer broke the whole conversation (2026-10-03)
- Tried: the human's dresser conversation, live, against Claude Haiku 4.5 on Bedrock.
- Expected: a reply after add_item.
- Happened: the model ended the turn with an empty message; we stored it and Bedrock rejected every later turn ("The content field in the Message object at messages.3 is empty"), so Alexa lost track of the dresser.
- Solved: an empty final answer is replaced by the last tool's spoken summary, never stored empty, and empty messages in saved sessions are repaired on load (agent.test.ts).
