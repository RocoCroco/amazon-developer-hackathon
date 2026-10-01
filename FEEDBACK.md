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
