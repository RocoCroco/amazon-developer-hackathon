import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createSimulatorHandler, type Asset, type SimulatorHandlerOptions } from './handler.js';

export type { DemoControls } from './handler.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Reads the page (index.html, app.js, styles.css) from a folder into the handler's asset map. */
export async function loadAssets(dir: string): Promise<Record<string, Asset>> {
  const assets: Record<string, Asset> = {};
  for (const name of await readdir(dir)) {
    const contentType = MIME[path.extname(name)];
    if (contentType)
      assets[`/${name}`] = { contentType, body: await readFile(path.join(dir, name), 'utf8') };
  }
  return assets;
}

export type SimulatorOptions = Omit<SimulatorHandlerOptions, 'assets'> & {
  /** Folder with index.html, app.js, styles.css. */
  staticDir: string;
};

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

/** Local HTTP server around the same handler the Lambda uses. Bound to localhost only. */
export async function startSimulator(
  { staticDir, ...options }: SimulatorOptions,
  port = 0,
  host = '127.0.0.1',
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const handler = createSimulatorHandler({ ...options, assets: await loadAssets(staticDir) });
  const server = createServer((req, res) => {
    void (async () => {
      const response = await handler(await toRequest(req, `http://${host}`));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"internal"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host}:${actual}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
