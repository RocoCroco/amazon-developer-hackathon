import { CpscRecallProvider } from './recalls/provider.js';
import { CompositeRecallProvider, NhtsaVehicleProvider } from './recalls/providers.js';
import { startNodeServer } from './node-server.js';
import { InMemoryItemStore } from './store.js';

/** Local dev server: in-memory inventory, live CPSC lookups. DEMO_KEY is optional locally. */
const server = await startNodeServer(
  {
    store: new InMemoryItemStore(),
    recalls: new CompositeRecallProvider([new CpscRecallProvider(), new NhtsaVehicleProvider()]),
    demoKey: process.env.DEMO_KEY,
  },
  Number(process.env.PORT ?? 8788),
);
console.log(`MCP server: ${server.url}`);
