// Loads CPSC recalls into the deployed recall cache FROM THIS MACHINE (T9.16).
// Why: since 2026-10-03 the CPSC API often answers HTTP 503 to requests from AWS while answering from a home
// connection (FRICTION_LOG F19), so the Lambda backfill cannot finish. Same code path as the watcher's
// {"backfill":"cpsc"} event, writing with the local AWS CLI profile.
// Usage: npm run build && node scripts/backfill-cpsc-local.mjs [since=2008-01-01] [until]
import { execFileSync } from 'node:child_process';
import { createDocClient } from '../packages/mcp-server/dist/dynamo-store.js';
import { DynamoRecallStore } from '../packages/mcp-server/dist/recalls/dynamo-recall-store.js';
import { backfillCpsc } from '../packages/mcp-server/dist/watcher.js';

const [since = '2008-01-01', until] = process.argv.slice(2);
const table = execFileSync(
  'aws',
  [
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'RecallGuardianStack',
    '--region',
    'us-east-1',
    '--query',
    "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue",
    '--output',
    'text',
  ],
  { encoding: 'utf8' },
).trim();

const store = new DynamoRecallStore(createDocClient(), table);
const started = Date.now();
const done = await backfillCpsc(store, since, undefined, undefined, undefined, until);
// Loaded through today: the copy is complete, so it may cover CPSC outages (StoreRecallProvider freshness).
if (!until) await store.setCursor('cpsc', new Date().toISOString().slice(0, 10));
console.log(
  JSON.stringify({
    table,
    since,
    until,
    ...done,
    seconds: Math.round((Date.now() - started) / 1000),
  }),
);
