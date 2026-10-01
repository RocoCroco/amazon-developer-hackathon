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
