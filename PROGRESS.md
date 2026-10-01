# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.4 - MCP server skeleton (official TS SDK, spec 2025-11-25+, stateless Streamable HTTP, JSON responses), in-memory store, tools `add_item` + `check_item`; verified by a scripted MCP SDK client over HTTP.

## Done
- Phase 0, T1.1, T1.2 (Recall schema + CPSC adapter), T1.3 (matcher in src/matcher/: normalize.ts, match.ts; 21 tests green).

## Left
- Install @modelcontextprotocol/sdk (check version supports protocol 2025-11-25), zod; build src/server.ts (createServer), src/http.ts (Node http, POST /mcp, stateless), tools add_item/check_item with voice-first responses, in-memory store, a CPSC recall provider (live fetch + cache, or fixture in tests).
- Integration test: start server on a random port, connect with SDK Client + StreamableHTTPClientTransport, list tools, add item, check item.

## Next step
`npm i -w @recall-guardian/mcp-server @modelcontextprotocol/sdk zod`, read the SDK's README for the Streamable HTTP server example, then write src/server.ts.
