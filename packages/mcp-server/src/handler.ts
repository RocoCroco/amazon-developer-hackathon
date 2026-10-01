import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RecallProvider } from './recalls/provider.js';
import type { ItemStore } from './store.js';
import { registerTools } from './tools.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface McpDeps {
  store: ItemStore;
  recalls: RecallProvider;
  /** When set, every request must send `Authorization: Bearer <demoKey>`. */
  demoKey?: string;
}

export const HOUSEHOLD_HEADER = 'x-household-id';
/** Random IDs of at least 128 bits, base64url (22+ chars). Guessing one is infeasible. */
const HOUSEHOLD_ID = /^[A-Za-z0-9_-]{22,64}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function keyMatches(header: string | null, expected: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Web-standard MCP endpoint (Streamable HTTP, stateless, JSON responses). Works under Node and
 * Lambda: both adapters just turn their request into a `Request`.
 * A fresh server+transport is created per request, as the SDK requires in stateless mode.
 */
export function createMcpHandler(deps: McpDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (deps.demoKey && !keyMatches(req.headers.get('authorization'), deps.demoKey)) {
      return json(401, { error: 'Missing or invalid demo key' });
    }
    const householdId = req.headers.get(HOUSEHOLD_HEADER) ?? '';
    if (!HOUSEHOLD_ID.test(householdId)) {
      return json(400, { error: `Missing or invalid ${HOUSEHOLD_HEADER} header` });
    }

    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerTools(server, { householdId, store: deps.store, recalls: deps.recalls });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}
