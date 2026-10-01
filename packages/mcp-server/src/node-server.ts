import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpHandler, type McpDeps } from './handler.js';

async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', base), {
    method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

/** Local HTTP server exposing the MCP endpoint at POST /mcp. Bound to localhost only. */
export async function startNodeServer(
  deps: McpDeps,
  port = 0,
  host = '127.0.0.1',
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const handler = createMcpHandler(deps);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/mcp') {
          res.writeHead(404).end();
          return;
        }
        const response = await handler(await toRequest(req, `http://${host}`));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"internal"}');
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host}:${actual}/mcp`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
