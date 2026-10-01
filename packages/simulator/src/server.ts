import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Session, TurnLimitError } from './agent.js';
import type { Llm } from './llm.js';
import { connectMcp, type McpConfig } from './mcp-connection.js';
import { clipForSpeech, SpeechBudget, type Speaker } from './speech.js';

/** Demo-mode controls (T5.2): what the "simulate new recall" button does. */
export interface DemoControls {
  /** Registers the sample family (a heater with a real recall, a car seat without one). */
  seedHousehold(session: Session): Promise<{ ok: boolean; message: string }>;
  /** Injects a brand new recall that matches something the session's household owns, via the daily watcher. */
  simulateNewRecall(session: Session): Promise<{ ok: boolean; message: string }>;
}

export interface SimulatorOptions {
  mcp: McpConfig;
  llm: () => Llm;
  /** Folder with index.html, app.js, styles.css. */
  staticDir: string;
  /** Text-to-speech (Amazon Polly). Without one, /api/speak answers 501 and the browser voice is used. */
  speaker?: Speaker;
  speechBudget?: SpeechBudget;
  demo?: DemoControls;
  /** Max request body size in bytes. */
  maxBody?: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage, maxBody: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBody) throw new HttpError(413, 'Message too long');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const asString = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Leaves nothing behind when a demo is reset: the household's items are removed (so the daily watcher
 * stops matching new recalls against a finished demo) and its alerts are closed.
 */
async function clearHousehold(session: Session): Promise<void> {
  try {
    const alerts = ((await session.tool('get_alerts')).alerts ?? []) as { alert_id: string }[];
    for (const a of alerts) {
      await session.tool('resolve_alert', { alert_id: a.alert_id, resolution: 'dismissed' });
    }
    const items = ((await session.tool('list_items')).items ?? []) as { item_id: string }[];
    for (const i of items) await session.tool('remove_item', { item_id: i.item_id, confirm: true });
  } catch {
    // Best effort: items expire by TTL anyway.
  }
}

export async function startSimulator(
  options: SimulatorOptions,
  port = 0,
  host = '127.0.0.1',
): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const sessions = new Map<string, Session>();
  const maxBody = options.maxBody ?? 8 * 1024;
  const budget = options.speechBudget ?? new SpeechBudget();

  async function open(): Promise<{ id: string; session: Session }> {
    const id = randomBytes(16).toString('base64url');
    const session = new Session(options.llm(), await connectMcp(options.mcp, id));
    sessions.set(id, session);
    return { id, session };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (status: number, body: unknown) =>
      void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJson(req, maxBody);
      const message = asString(body.message).trim();
      if (!message) return json(400, { error: 'message is required' });
      let id = asString(body.sessionId);
      let session = sessions.get(id);
      if (!session) ({ id, session } = await open());
      try {
        return json(200, { sessionId: id, ...(await session.say(message)) });
      } catch (error) {
        if (error instanceof TurnLimitError) {
          return json(429, { error: 'This demo session has reached its limit. Please reset.' });
        }
        throw error;
      }
    }

    // What this deployment can do, so the page can hide controls that would not work.
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(200, { speech: !!options.speaker, demo: !!options.demo });
    }

    // Inventory and alerts for the side panels, read straight from the MCP tools.
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const session = sessions.get(url.searchParams.get('sessionId') ?? '');
      if (!session) return json(200, { items: [], alerts: [] });
      const [items, alerts] = await Promise.all([
        session.tool('list_items'),
        session.tool('get_alerts'),
      ]);
      return json(200, { items: items.items ?? [], alerts: alerts.alerts ?? [] });
    }

    if (req.method === 'POST' && url.pathname === '/api/speak') {
      if (!options.speaker) return json(501, { error: 'Speech is not configured' });
      const body = await readJson(req, maxBody);
      const text = clipForSpeech(asString(body.text));
      if (!text) return json(400, { error: 'text is required' });
      const who = sessions.has(asString(body.sessionId)) ? asString(body.sessionId) : 'anonymous';
      if (!budget.tryUse(who, text.length)) {
        return json(429, { error: 'Voice budget used up; the browser voice takes over.' });
      }
      const speech = await options.speaker.synthesize(text);
      res
        .writeHead(200, {
          'content-type': speech.contentType,
          'cache-control': 'private, max-age=3600',
        })
        .end(Buffer.from(speech.audio));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/seed') {
      if (!options.demo) return json(404, {});
      let id = asString((await readJson(req, maxBody)).sessionId);
      let session = sessions.get(id);
      if (!session) ({ id, session } = await open());
      return json(200, { sessionId: id, ...(await options.demo.seedHousehold(session)) });
    }

    if (req.method === 'POST' && url.pathname === '/api/demo/new-recall') {
      if (!options.demo) return json(404, {});
      const session = sessions.get(asString((await readJson(req, maxBody)).sessionId));
      if (!session) return json(400, { error: 'Start a conversation first.' });
      return json(200, await options.demo.simulateNewRecall(session));
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const id = asString((await readJson(req, maxBody)).sessionId);
      const old = sessions.get(id);
      if (old) {
        sessions.delete(id);
        await clearHousehold(old);
        await old.close();
      }
      return json(200, { ok: true });
    }

    if (req.method === 'GET') {
      const file = url.pathname === '/' ? '/index.html' : url.pathname;
      const root = path.resolve(options.staticDir);
      const resolved = path.join(root, path.normalize(file));
      if (!resolved.startsWith(root + path.sep)) return json(403, {});
      const ext = path.extname(resolved);
      const content = MIME[ext] ? await readFile(resolved).catch(() => undefined) : undefined;
      if (!content) return json(404, {});
      return void res.writeHead(200, { 'content-type': MIME[ext]! }).end(content);
    }
    json(404, {});
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        res
          .writeHead(error.status, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: error.message }));
        return;
      }
      console.error('simulator error:', error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Something went wrong. Please try again.' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host}:${actual}`,
    close: async () => {
      for (const session of sessions.values()) await session.close().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
