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
