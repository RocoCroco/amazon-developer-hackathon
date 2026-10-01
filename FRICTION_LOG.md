# FRICTION LOG

Format: what I tried / what I expected / what happened / how I solved it.

## F1 - Vitest 5 fails on Windows: "Cannot find native binding" (2026-10-01)
- Tried: `npm i -D vitest` (v5, bundled with Vite 8 / rolldown) on native Windows 11, then `npm test`.
- Expected: tests run.
- Happened: startup error "Cannot find native binding ... npm has a bug related to optional dependencies". A clean reinstall did not help. The real cause was hidden by that message: loading `rolldown-binding.win32-x64-msvc.node` directly gave "An Application Control policy has blocked this file." (Windows Application Control blocks unsigned native .node files on this machine.) The misleading npm-bug message cost several minutes.
- Solved: use Vitest 3 (Vite 7, esbuild, which runs here) and override rollup with the pure-WASM `@rollup/wasm-node` via `overrides` in root package.json. Did not attempt to bypass the policy.
- Consequence: avoid dependencies with unsigned native addons (rolldown, rollup native, swc) in this repo; check any new tool with a quick run.
