# PRODUCT FEEDBACK

Per-tool impressions for the hackathon submission. One section per tool/SDK; add entries as we go.
Template per entry: **What worked / What didn't / Suggestion**.

## MCP TypeScript SDK (@modelcontextprotocol/sdk)
-

## Amazon Bedrock (Claude)
-

## AWS CDK
-

## AWS Lambda (Function URLs) / DynamoDB / EventBridge
-

## Amazon Polly
-

## CPSC Recalls API
-

## NHTSA recalls API / vPIC
-

## openFDA
-

## Tooling (Vitest, npm, Windows)
- Vitest 5 on Windows with Application Control: misleading "Cannot find native binding" error; see FRICTION_LOG F1.

## Recall APIs (T1.1 notes)
- CPSC: free, no key, has date filters, but the date filters are undocumented on the public page, and `Products[].Model` is empty so model numbers live in free text.
- NHTSA: vehicle JSON API is easy, but no "since date" and no car seat/equipment endpoint; need the bulk flat file (311 MB, daily). Unknown routes answer "Missing Authentication Token", which is misleading.
- openFDA: clean query language and clear limits; nice date-range search.

## MCP TypeScript SDK 1.31 (T1.4 notes)
- Worked: `LATEST_PROTOCOL_VERSION` is `2025-11-25`; `WebStandardStreamableHTTPServerTransport.handleRequest(Request): Promise<Response>` makes Lambda/Node adapters trivial; stateless mode + `enableJsonResponse: true` gives plain JSON replies that are easy to test with the SDK client over a real socket.
- Worked: `registerTool` with zod raw shapes and `structuredContent` is concise; zod 4 is accepted.
- Friction: stateless mode needs a new `McpServer` + transport per request (documented only in examples/comments); per-request identity has to be passed via closure or `requestInfo.headers`, there is no first-class "caller identity" concept short of the full OAuth machinery.
- Suggestion: a documented "serverless handler" recipe (Lambda Function URL) and a short guide on stateless identity would save time.

## AWS CDK / Lambda Function URLs (T1.6 notes)
- CDK: `NodejsFunction` + esbuild bundles the MCP SDK app into one 840 KB file in ~100 ms, deploy of the whole stack took 35 s. `logRetention` is deprecated in favor of `logGroup` (the warning is clear). Running `cdk synth` directly uses stale compiled output when the app is TS compiled separately; wrap it in an npm script that builds first.
- Lambda Function URLs: simple public HTTPS, works with the SDK's web-standard transport via a ~30-line adapter. No built-in throttling or API keys, and new accounts' 10-concurrency quota blocks reserved concurrency (see FRICTION_LOG F5).

## Playwright (T1.8 notes)
- `playwright-core` + `npx playwright-core install chromium-headless-shell` works on this locked-down Windows machine (no Chrome/Edge installed, Application Control active); headless Chromium launches fine.
- Playwright's `expect` matchers (`toBeVisible`, `toContainText`...) live in `@playwright/test`; with Vitest use `expect.poll(() => locator.textContent())`.

## NHTSA flat file (T2.1 notes)
- One row per make x model, with the campaign's prose repeated on every row; grouping by campaign number is required. Manufacturing windows are in BGMAN/ENDMAN only for some rows; otherwise only in prose. When both exist they can differ by a day (column 2010-04-10 vs prose "April 9"); we trust the column.
