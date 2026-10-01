import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { startNodeServer } from './node-server.js';
import { CpscRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';

/** Hits the real CPSC API. Run with: npm run test:live */
describe.skipIf(!process.env.LIVE)('live CPSC through the MCP server', () => {
  it('finds the real GoveeLife heater recall via MCP', async () => {
    const s = await startNodeServer({
      store: new InMemoryItemStore(),
      recalls: new CpscRecallProvider(),
    });
    const client = new Client({ name: 'live-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(s.url), {
        requestInit: { headers: { 'x-household-id': 'liveLiveLiveLiveLive01' } },
      }),
    );
    const res = await client.callTool({
      name: 'check_item',
      arguments: { name: 'space heater', brand: 'Govee', model: 'H7131' },
    });
    expect(res.structuredContent).toMatchObject({ status: 'recalled' });
    await client.close();
    await s.close();
  }, 60_000);
});
