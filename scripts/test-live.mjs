// Cross-platform way to run the opt-in live tests (real network): npm run test:live
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', 'live'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, LIVE: '1' },
});
process.exit(result.status ?? 1);
