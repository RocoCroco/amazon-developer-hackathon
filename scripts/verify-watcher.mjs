// Verifies the DEPLOYED daily watcher end to end (T4.4):
//  1. through the real MCP endpoint, register an item no real recall matches,
//  2. invoke the deployed watcher Lambda with a seeded ("demo") recall for exactly that item,
//  3. read the proactive alert and its fix back through MCP,
//  4. clean up (resolve the alert, remove the item).
// Usage: node scripts/verify-watcher.mjs   (AWS CLI profile needed; the demo key is read from SSM, never printed)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const aws = (...args) =>
  execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'text'], {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  }).trim();

const output = (key) =>
  aws(
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'RecallGuardianStack',
    '--query',
    `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`,
  );

const url = output('McpUrl');
const watcher = output('WatcherFunctionName');
const demoKey = aws(
  'ssm',
  'get-parameter',
  '--name',
  '/recall-guardian/demo-key',
  '--with-decryption',
  '--query',
  'Parameter.Value',
);

const client = new Client({ name: 'verify-watcher', version: '0.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        authorization: `Bearer ${demoKey}`,
        'x-household-id': randomBytes(16).toString('base64url'),
      },
    },
  }),
);
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { summary: res.content[0].text, data: res.structuredContent };
};
const fail = (message) => {
  console.error('FAILED:', message);
  process.exitCode = 1;
};

// 1. An item that no real recall can match (fictional brand), so the alert can only come from the seed.
const stamp = Date.now();
const brand = 'Zzyzx';
const added = await call('add_item', { name: 'space heater', brand, model: 'ZX-100' });
console.log('add_item        ->', added.summary);
if ((await call('get_alerts')).data.count !== 0) fail('expected no alerts before the watcher ran');

// 2. Invoke the deployed watcher with a seeded recall for that item.
const seed = {
  id: `demo:verify-${stamp}`,
  source: 'cpsc',
  sourceId: `verify-${stamp}`,
  category: 'consumer',
  title: `${brand} Space Heaters Recalled Due to Fire Hazard (demo)`,
  summary: `This recall involves ${brand} space heaters, model number ZX-100.`,
  hazard: 'The heaters can overheat, posing a fire hazard.',
  remedy:
    'Consumers should stop using the recalled heaters immediately and contact Zzyzx for a free replacement.',
  remedyOptions: ['replace'],
  contact: 'Call Zzyzx toll-free at 800-555-0123.',
  url: 'https://www.cpsc.gov/Recalls',
  publishedAt: new Date().toISOString().slice(0, 10),
  brands: [brand],
  products: [{ name: `${brand} Space Heaters`, models: ['ZX-100'] }],
  years: [],
};
const payloadFile = path.join(tmpdir(), `watcher-payload-${stamp}.json`);
const outFile = path.join(tmpdir(), `watcher-out-${stamp}.json`);
writeFileSync(payloadFile, JSON.stringify({ seed: [seed] }));
console.log(
  'invoking the deployed watcher (it also syncs the real feeds on first run, ~10-60 s)...',
);
execFileSync(
  'aws',
  [
    'lambda',
    'invoke',
    '--function-name',
    watcher,
    '--region',
    'us-east-1',
    '--cli-binary-format',
    'raw-in-base64-out',
    '--payload',
    `file://${payloadFile}`,
    '--cli-read-timeout',
    '600',
    outFile,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);
const result = JSON.parse(readFileSync(outFile, 'utf8'));
if (result.errorMessage) {
  fail(`watcher error: ${result.errorMessage}`);
} else {
  console.log('watcher result  ->', {
    recallsExamined: result.recallsExamined,
    households: result.households,
    itemsChecked: result.itemsChecked,
    alertsCreated: result.alertsCreated,
  });
  for (const f of result.feeds) {
    console.log(
      `  feed ${f.source}:`,
      f.error ? `ERROR ${f.error}` : `fetched ${f.fetched}, added ${f.added}`,
    );
  }
}

// 3. The household now has a proactive alert.
const alerts = await call('get_alerts');
console.log('get_alerts      ->', alerts.summary);
const mine = alerts.data.alerts?.find((a) => a.title.includes('(demo)'));
if (!mine) fail('the seeded recall did not produce an alert for the registered item');
else {
  const remedy = await call('get_remedy', { alert_id: mine.alert_id });
  console.log('get_remedy      ->', remedy.summary);
  // 4. Clean up what we created.
  await call('resolve_alert', { alert_id: mine.alert_id, resolution: 'dismissed' });
}
await call('remove_item', { item_id: added.data.item_id, confirm: true });
await client.close();
console.log(
  process.exitCode
    ? 'WATCHER VERIFICATION FAILED'
    : 'WATCHER VERIFIED: seeded recall -> proactive alert -> remedy',
);
