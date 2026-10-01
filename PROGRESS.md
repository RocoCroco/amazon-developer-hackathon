# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.5 - DynamoDB data layer replacing the in-memory store (ItemStore interface in src/store.ts). Household IDs are already validated as unguessable (>=22 base64url chars) in src/handler.ts.

## Done
- Phase 0; T1.1-T1.4. MCP server: src/handler.ts (web-standard, stateless, demo key + household header), src/node-server.ts (local), src/tools.ts (add_item, check_item), src/voice.ts, src/recalls/provider.ts (CPSC live+cache, static). 36 tests green; `npm run test:live` (real CPSC via MCP) passes.

## Left
- DynamoDBItemStore implementing ItemStore with @aws-sdk/lib-dynamodb; table design: PK=HOUSEHOLD#<id>, SK=ITEM#<id>. Tests with an injected fake DocumentClient (or aws-sdk-client-mock). Helper to generate household IDs (crypto.randomBytes(16) base64url).

## Next step
`npm i -w @recall-guardian/mcp-server @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` and `-D aws-sdk-client-mock`; check for native-binary deps (Windows Application Control, see FRICTION_LOG F1) by running tests right after install.
