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
await client.close();
if (checked.structuredContent.status !== 'recalled') process.exit(1);
