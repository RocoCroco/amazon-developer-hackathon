// Smoke test of the DEPLOYED MCP server with a real MCP client (T1.6).
// Usage: node scripts/smoke-deployed.mjs   (needs the AWS CLI profile; the demo key is read from SSM, never printed)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const aws = (...args) =>
  execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'text'], {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  }).trim();

const url =
  process.env.MCP_URL ??
  aws(
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'RecallGuardianStack',
    '--query',
    "Stacks[0].Outputs[?OutputKey=='McpUrl'].OutputValue",
  );
const key = aws(
  'ssm',
  'get-parameter',
  '--name',
  '/recall-guardian/demo-key',
  '--with-decryption',
  '--query',
  'Parameter.Value',
);

const client = new Client({ name: 'smoke-test', version: '0.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        authorization: `Bearer ${key}`,
        'x-household-id': randomBytes(16).toString('base64url'),
      },
    },
  }),
);
console.log('server:', client.getServerVersion()?.name);
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const text = (r) => r.content[0].text;
const added = await client.callTool({
  name: 'add_item',
  arguments: { name: 'space heater', brand: 'Govee', model: 'H7131' },
});
console.log('add_item  ->', text(added));
const checked = await client.callTool({
  name: 'check_item',
  arguments: { item_id: added.structuredContent.item_id },
});
console.log('check_item ->', text(checked), '| status:', checked.structuredContent.status);

// Real data from the other official sources must be reachable too (these once were not):
//  - a child seat from the NHTSA data the watcher caches (needs the one-time backfill),
//  - a vehicle looked up live at NHTSA by make, model and model year.
const cases = [
  {
    label: 'child seat (NHTSA cache)',
    args: { name: 'car seat', brand: 'Graco', model: 'SnugRide', year: 2012 },
  },
  {
    label: 'vehicle (live NHTSA)',
    args: { name: 'car', brand: 'Toyota', model: 'Camry', year: 2020 },
  },
];
let failures = 0;
for (const c of cases) {
  const r = await client.callTool({ name: 'check_item', arguments: c.args });
  const ok = r.structuredContent.status === 'recalled';
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.label} -> ${text(r).slice(0, 110)}`);
}

// Leave nothing behind: remove the sample item (and the alert check_item recorded for it).
const alerts = await client.callTool({ name: 'get_alerts', arguments: {} });
for (const alert of alerts.structuredContent.alerts ?? []) {
  await client.callTool({
    name: 'resolve_alert',
    arguments: { alert_id: alert.alert_id, resolution: 'dismissed' },
  });
}
await client.callTool({
  name: 'remove_item',
  arguments: { item_id: added.structuredContent.item_id, confirm: true },
});
await client.close();
if (checked.structuredContent.status !== 'recalled' || failures > 0) process.exit(1);
