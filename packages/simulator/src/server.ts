import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Session, TurnLimitError, type ToolTrace } from './agent.js';
import type { Llm } from './llm.js';
import { connectMcp, type McpConfig } from './mcp-connection.js';

export interface SimulatorItem {
  id: string;
  name: string;
  brand?: string;
  model?: string;
}

interface Entry {
  session: Session;
  items: SimulatorItem[];
}

export interface SimulatorOptions {
  mcp: McpConfig;
  llm: () => Llm;
  /** Folder with index.html, app.js, styles.css. */
  staticDir: string;
  /** Max request body size in bytes. */
  maxBody?: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Items the assistant registered in this session, read from the add_item tool results. */
function itemsFrom(calls: ToolTrace[]): SimulatorItem[] {
  const items: SimulatorItem[] = [];
  for (const c of calls) {
    if (c.name !== 'add_item' || c.isError) continue;
    try {
      const data = JSON.parse(c.result.split('\n').at(-1) ?? '{}') as { item_id?: string };
      if (data.item_id) {
        const { name, brand, model } = c.args as Omit<SimulatorItem, 'id'>;
        items.push({ id: data.item_id, name, brand, model });
      }
    } catch {
      // Result was not JSON; nothing to show in the inventory.
    }
  }
  return items;
}

export async function startSimulator(
  options: SimulatorOptions,
  port = 0,
  host = '127.0.0.1',
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const sessions = new Map<string, Entry>();
  const maxBody = options.maxBody ?? 8 * 1024;

  async function open(): Promise<{ id: string; entry: Entry }> {
    const id = randomBytes(16).toString('base64url');
    const mcp = await connectMcp(options.mcp, id);
    const entry = { session: new Session(options.llm(), mcp), items: [] };
    sessions.set(id, entry);
    return { id, entry };
  }

  const server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (req.method === 'POST' && url.pathname === '/api/chat') {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > maxBody) return send(413, { error: 'Message too long' });
            chunks.push(chunk as Buffer);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
            sessionId?: string;
            message?: string;
          };
          const message = (body.message ?? '').trim();
          if (!message) return send(400, { error: 'message is required' });

          let id = body.sessionId ?? '';
          let entry = sessions.get(id);
          if (!entry) ({ id, entry } = await open());
          try {
            const turn = await entry.session.say(message);
            entry.items.push(...itemsFrom(turn.toolCalls));
            return send(200, { sessionId: id, ...turn, items: entry.items });
          } catch (error) {
            if (error instanceof TurnLimitError) {
              return send(429, { error: 'This demo session has reached its limit. Please reset.' });
            }
            throw error;
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/reset') {
          const body = await new Promise<string>((resolve) => {
            let data = '';
            req.on('data', (c: Buffer) => (data += c.toString('utf8')));
            req.on('end', () => resolve(data));
          });
          const { sessionId } = JSON.parse(body || '{}') as { sessionId?: string };
          const old = sessionId ? sessions.get(sessionId) : undefined;
          if (old && sessionId) {
            sessions.delete(sessionId);
            await old.session.close();
          }
          return send(200, { ok: true });
        }

        if (req.method === 'GET') {
          const file = url.pathname === '/' ? '/index.html' : url.pathname;
          const root = path.resolve(options.staticDir);
          const resolved = path.join(root, path.normalize(file));
          if (!resolved.startsWith(root + path.sep)) return send(403, {});
          const ext = path.extname(resolved);
          if (!MIME[ext]) return send(404, {});
          const content = await readFile(resolved).catch(() => undefined);
          if (!content) return send(404, {});
          return void res.writeHead(200, { 'content-type': MIME[ext] }).end(content);
        }
        send(404, {});
      } catch (error) {
        console.error('simulator error:', error instanceof Error ? error.message : error);
        send(500, { error: 'Something went wrong. Please try again.' });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host}:${actual}`,
    close: async () => {
      for (const { session } of sessions.values()) await session.close().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
