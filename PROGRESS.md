# PROGRESS

_Last updated: 2026-10-03_

## Current task
Phase 9 (human feedback), group C voice: T9.9 phonetic brand matching (MCP server).

## Done (within this phase)
- B (T9.4-T9.8): contain-fitted photo (no upscaling, blurred surround), glass panel, settings dialog, breathing-glow thinking. Deployed.
- A (T9.1-T9.3): add_item/update_item check on save (panel turns red in the same turn, smooth unfold), scrollable chat, no greeting. Source-outage honesty (`source_unavailable`). Deployed.

## Left
- C (T9.9-T9.11) -> deploy -> URL. D (T9.12-T9.16).

## Next step
Implement phonetic brand matching in packages/mcp-server/src/matcher (new module), wire it into suggestBrands in matcher/clarify.ts, tests with realistic misrecognitions.

## Human steps
docs/manual-checklist.md: voice check in Chrome, record video, flip repo public (T7.2), fill Devpost.
