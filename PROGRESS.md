# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.8 - Minimal text web UI (transcript + inventory panel) served by a simulator HTTP backend; verify with Playwright (use MOCK LLM since Bedrock is blocked, BLOCKERS B1).

## Done
- Phase 0; T1.1-T1.6 done; T1.7 code done ([!] only because live Bedrock verification is blocked by B1).
- packages/simulator/src: llm.ts (Llm interface, BedrockLlm, ScriptedLlm), mcp-connection.ts (real MCP client), agent.ts (Session: tool loop, turn + tool-round limits, tool trace). 56 tests green; `npm run test:live` runs real-network tests (mcp-server live passes; simulator live fails on B1).

## Left
- src/server.ts: node http server: POST /api/chat {sessionId?, message} -> {sessionId, reply, toolCalls}; GET /api/inventory?sessionId -> items; serves static UI from packages/simulator/public. LLM selectable: real Bedrock, or a deterministic "demo brain" mock (env SIM_LLM=mock) so the UI works without Bedrock.
- public/index.html + app.js + styles.css (transcript, input, inventory panel).
- Playwright (or playwright-core with installed Chrome) e2e test; check Application Control doesn't block the browser.

## Next step
Decide the mock brain: a small rule-based Llm implementation (regex intents: "got a <brand> <product>", "model is X", "is it recalled") that emits real tool calls to the MCP server. Then write server.ts.
