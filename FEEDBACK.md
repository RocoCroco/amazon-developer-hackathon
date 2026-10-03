# PRODUCT FEEDBACK

Impressions of every tool, SDK and API used to build Recall Guardian, from a three-week-style build compressed into
a few days. Each entry: **What worked / What didn't / Suggestion**. The matching blow-by-blow problems are in
FRICTION_LOG.md (entries F1-F12).

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.31, spec 2025-11-25)
**What worked**
- `LATEST_PROTOCOL_VERSION` is `2025-11-25` out of the box, and the SDK client negotiated it with our server first try.
- `WebStandardStreamableHTTPServerTransport.handleRequest(Request): Promise<Response>` is the best part: one
  handler runs under Node, Lambda and tests with a ~30-line adapter. Stateless mode plus `enableJsonResponse: true`
  gives plain JSON replies that are easy to test with the real SDK client over a real socket.
- `registerTool` with zod raw shapes, `structuredContent` and tool annotations (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`) is concise and maps well onto a voice product: the first text block is the spoken sentence, the
  structured content is for the UI.
**What didn't**
- Stateless mode needs a new `McpServer` and transport per request; this is visible only in examples and comments.
- There is no first-class notion of caller identity short of full OAuth. We passed a household id and a demo key in
  headers and closed over them per request; that works but every team will reinvent it.
**Suggestion**: a documented "serverless handler" recipe (Lambda Function URL, per-request identity) and a short
guide on stateless identity would save a day.

## Amazon Bedrock (Claude Haiku 4.5, Converse API)
**What worked**
- The Converse API is pleasant: the same request shape for plain prompts, tool use and JSON-only prompts; `temperature: 0`
  plus a strict system prompt gave parseable second opinions (we still parse tolerantly). Haiku 4.5 answered a full
  tool-using turn against our MCP server in about 3-4 seconds.
**What didn't**
- `list-foundation-models` shows models as ACTIVE even when the account cannot invoke them. The real blocker only
  appears at invoke time: "Model use case details have not been submitted for this account" (a form), or "not
  available for this account" for newer models. Access also flipped from working to failing within minutes
  (FRICTION_LOG F6) before it settled.
- IAM for the cross-region inference profile needs both the profile ARN and the foundation-model ARNs in other regions.
**Suggestion**: a "can I invoke this model?" check in the console and CLI, and one clear message for missing
use-case approval, would remove most of the guessing. A documented minimal IAM policy for `us.*` inference profiles too.

## AWS CDK
**What worked**
- `NodejsFunction` + esbuild bundles the MCP SDK app into one ~840 KB file in about 100 ms; a whole stack (three
  Lambdas, table, rule, two Function URLs) deploys in 35-150 s. The `assertions` module let us encode our safety
  rules as tests (no hourly-cost resources, no wildcard actions, tags, Function URL only where intended).
**What didn't**
- `logRetention` is deprecated in favor of `logGroup` (a clear warning, easy to fix).
- When the CDK app is compiled separately, `cdk synth` run directly uses stale output; wrap it in an npm script that builds first.
- Default bootstrap grants AdministratorAccess to the deploy role; fine here, worth a warning for production.
**Suggestion**: a `cdk` template for "TypeScript app compiled with tsc" that wires the build step.

## AWS Lambda (Function URLs), DynamoDB, EventBridge
**What worked**
- Function URLs make a public HTTPS MCP endpoint trivial; the whole stack stays serverless with no hourly price.
- DynamoDB single-table design with TTL fits a demo (inventory, alerts, recall cache, cursors, sessions, atomic daily
  caps via conditional `ADD`). A daily `events.Rule` is ~10 lines; `aws lambda invoke --payload file://` triggers it by hand with
  a custom event, which we use to inject a demo recall.
**What didn't**
- New accounts have a 10-concurrent-executions quota, which makes reserved concurrency impossible (F5); Function URLs have
  no built-in throttling or API keys, so abuse protection has to live in code.
- Binary responses (Polly MP3) need manual base64 handling in the Function URL adapter.
**Suggestion**: surface the concurrency quota and its consequence when creating a Function URL; optional built-in rate limiting.

## Amazon Polly
**What worked**: neural voices and SSML are excellent for this product. `<say-as interpret-as="characters">` makes
model codes ("H7131") audible and unambiguous, and one reply costs a fraction of a cent. The API was usable without any
account setup beyond IAM.
**What didn't**: nothing blocking. Choosing the voice that sounds most like Alexa is a taste test the docs cannot help with.
**Suggestion**: a short "voice assistant replies" guide (codes, phone numbers, pauses) would be popular.

## CPSC Recalls API (SaferProducts.gov)
**What worked**: free, no key, JSON, and it has date filters (`RecallDateStart`, `LastPublishDateStart`) that make
incremental sync easy. `ProductName=` is a working substring search.
**What didn't**: `Title=` is silently ignored and returns every recall (27 MB, F3); date filters are undocumented on the public
page; `Products[].Model` is almost always empty, so model numbers have to be parsed out of free text; the importer and
manufacturer fields contain codes and addresses that look like brands.
**Suggestion**: document the filters, return a 400 for unknown parameters, and add structured model numbers.

## NHTSA recalls API, bulk flat file and vPIC
**What worked**: `recallsByVehicle` is simple and fast; vPIC decodes VINs without a key; the daily flat file is the only
place child seats, tires and equipment are available and is easy to stream.
**What didn't**: no "since date" query on the API; no equipment or child-seat endpoint (unknown routes answer
"Missing Authentication Token", F2); unknown vehicle models answer HTTP 400; the flat file is 311 MB with one row per make x
model and the campaign text repeated on every row; manufacturing windows are sometimes only in prose and can differ by a
day from the structured columns.
**Suggestion**: a JSON endpoint for child seats and equipment, and a date filter on the vehicle API.

## openFDA
**What worked**: a clean query language (`report_date:[A TO B]`, `sort`, paging), clear limits (240 requests/min and 1,000/day without a key), data updated weekly.
**What didn't**: `recall_number` is sometimes the string "N/A" in both the food and drug feeds, so it is not a safe
primary key (F8); enforcement reports carry no consumer remedy text.
**Suggestion**: document the "N/A" case and recommend `event_id` as the key.

## Playwright and Vitest (tooling)
**What worked**: `playwright-core` plus `playwright-core install chromium-headless-shell` runs on a locked-down Windows
machine with no Chrome installed; stubbing the Web Speech API with `addInitScript` lets us test push-to-talk and spoken
replies in a real browser.
**What didn't**: Vitest 5 failed on a Windows machine with Application Control because its bundler needs an unsigned
native addon, with a misleading "Cannot find native binding" error (F1); Playwright's own matchers need `@playwright/test`,
so under Vitest we poll locators; headless Chromium ships its own `SpeechRecognition`, which wins over a stub unless both
names are overridden (F11).
**Suggestion**: report Application Control blocks explicitly in the error message.

## Claude Code (building with an autonomous agent on Windows)
**What worked**: working from SPEC/TASKS/PROGRESS files with commit-per-task kept a long autonomous session resumable.
**What didn't**: generating regex-heavy source through shell snippets silently dropped backslashes (F7); a stale cached PDF
reader and no PDF renderer meant primary sources needed a small pure-JS extractor (F12).
**Suggestion**: an Edit-style tool for "append this file region" would avoid most shell-escaping workarounds.

## Amazon Transcribe (streaming over WebSocket, custom vocabulary)
**What worked**: a presigned WebSocket URL lets the browser stream the microphone straight to Transcribe while the
credentials stay on the server; SigV4 presigning with `@smithy/signature-v4` was a few lines. US English is forced per
request (`language-code=en-US`), independent of the user's browser or Windows language. A first live test (Polly speech
as 16 kHz PCM, our own event-stream framing) worked on the first try. Partial-result stabilization keeps the live
caption from flickering.
**What didn't**: the developer guide's base64 audio-event example is garbled (bad header bytes and message CRC; F20),
so it cannot be used to verify an encoder. There is no JavaScript example of the WebSocket protocol without the SDK's
HTTP/2 client, which does not run in browsers. The custom vocabulary's `SoundsLike` and `IPA` columns are no longer
supported, so a brand whose spelling does not match its sound ("Chicco" said "kiko", "Evenflo" heard "even flow")
cannot be taught; on our ten synthetic test sentences the 1,959-brand vocabulary made no measurable difference.
**Suggestion**: bring back pronunciation hints for custom vocabularies (brand names are exactly where they are needed),
and publish a minimal browser WebSocket example with a verifiable event-stream frame.
