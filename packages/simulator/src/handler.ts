import { randomBytes } from 'node:crypto';
import { Session, TurnLimitError, type Limits } from './agent.js';
import type { Llm } from './llm.js';
import { connectMcp, type McpConfig } from './mcp-connection.js';
import {
  InMemoryDailyCap,
  InMemorySessionStore,
  type DailyCap,
  type SessionStore,
  type StoredSession,
} from './session-store.js';
import { clipForSpeech, type Speaker } from './speech.js';

/** Demo-mode controls: what the "simulate new recall" button does. */
export interface DemoControls {
  /** Registers the sample family (a heater with a real recall, a car seat without one). */
  seedHousehold(session: Session): Promise<{ ok: boolean; message: string }>;
  /** Injects a brand new recall that matches something the session's household owns, via the daily watcher. */
  simulateNewRecall(session: Session): Promise<{ ok: boolean; message: string }>;
}

/** A static file of the page. */
export interface Asset {
  contentType: string;
  body: string | Uint8Array;
}

export interface SimulatorHandlerOptions {
  mcp: McpConfig;
  llm: () => Llm;
  /** The page, keyed by path ("/index.html", "/app.js", "/styles.css"). "/" serves "/index.html". */
  assets: Record<string, Asset>;
  /** Where conversations live between requests. In-memory by default; DynamoDB on Lambda. */
  sessions?: SessionStore;
  /** Text-to-speech (Amazon Polly). Without one, /api/speak answers 501 and the browser voice is used. */
  speaker?: Speaker;
  /** Characters one conversation may have spoken. */
  sessionSpeechChars?: number;
  /** Characters all conversations together may have spoken per day. */
  speechCap?: DailyCap;
  /** Conversation turns (model calls) all sessions together may use per day. */
  turnCap?: DailyCap;
  limits?: Limits;
  demo?: DemoControls;
  /** Max request body size in bytes. */
  maxBody?: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const asString = (v: unknown) => (typeof v === 'string' ? v : '');

async function readJson(req: Request, maxBody: number): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBody) throw new HttpError(413, 'Message too long');
  try {
    return JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

/**
 * The whole simulator backend as a web-standard handler (Request -> Response), so one implementation runs
 * under Node and Lambda. It keeps no memory between requests: a conversation is loaded from the session
 * store, given a fresh MCP connection (the MCP server is stateless, so that is cheap), and saved back.
 */
export function createSimulatorHandler(
  options: SimulatorHandlerOptions,
): (req: Request) => Promise<Response> {
  const sessions = options.sessions ?? new InMemorySessionStore();
  const maxBody = options.maxBody ?? 8 * 1024;
  const sessionSpeechChars = options.sessionSpeechChars ?? 6_000;
  const speechCap = options.speechCap ?? new InMemoryDailyCap(120_000);
  const turnCap = options.turnCap ?? new InMemoryDailyCap(600);

  /** Runs `work` with the session, an open MCP connection, and saves the conversation afterwards. */
  async function withSession<T>(
    stored: StoredSession,
    work: (session: Session) => Promise<T>,
    { save = true }: { save?: boolean } = {},
  ): Promise<T> {
    const mcp = await connectMcp(options.mcp, stored.id);
    const session = new Session(options.llm(), mcp, options.limits, stored);
    try {
      return await work(session);
    } finally {
      if (save)
        await sessions.put({ ...stored, messages: session.messages, turns: session.turnCount });
      await mcp.close().catch(() => undefined);
    }
  }

  const newSession = (): StoredSession => ({
    id: randomBytes(16).toString('base64url'),
    messages: [],
    turns: 0,
  });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === 'POST' && pathname === '/api/chat') {
      const body = await readJson(req, maxBody);
      const message = asString(body.message).trim();
      if (!message) return json(400, { error: 'message is required' });
      const stored = (await sessions.get(asString(body.sessionId))) ?? newSession();
      if (!(await turnCap.tryUse(1))) {
        return json(429, {
          error: 'The demo has reached its daily limit. Please try again tomorrow.',
        });
      }
      try {
        return json(200, {
          sessionId: stored.id,
          ...(await withSession(stored, (session) => session.say(message))),
        });
      } catch (error) {
        if (error instanceof TurnLimitError) {
          return json(429, { error: 'This demo session has reached its limit. Please reset.' });
        }
        throw error;
      }
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      return json(200, { speech: !!options.speaker, demo: !!options.demo });
    }

    // Inventory and alerts for the side panels, read straight from the MCP tools.
    if (req.method === 'GET' && pathname === '/api/state') {
      const stored = await sessions.get(url.searchParams.get('sessionId') ?? '');
      if (!stored) return json(200, { items: [], alerts: [] });
      return withSession(
        stored,
        async (session) => {
          const [items, alerts] = await Promise.all([
            session.tool('list_items'),
            session.tool('get_alerts'),
          ]);
          return json(200, { items: items.items ?? [], alerts: alerts.alerts ?? [] });
        },
        { save: false },
      );
    }

    if (req.method === 'POST' && pathname === '/api/speak') {
      if (!options.speaker) return json(501, { error: 'Speech is not configured' });
      const body = await readJson(req, maxBody);
      const text = clipForSpeech(asString(body.text));
      if (!text) return json(400, { error: 'text is required' });
      const stored = await sessions.get(asString(body.sessionId));
      const used = stored?.speechChars ?? 0;
      if (
        !stored ||
        used + text.length > sessionSpeechChars ||
        !(await speechCap.tryUse(text.length))
      ) {
        return json(429, { error: 'Voice budget used up; the browser voice takes over.' });
      }
      await sessions.put({ ...stored, speechChars: used + text.length });
      const speech = await options.speaker.synthesize(text);
      return new Response(Buffer.from(speech.audio), {
        status: 200,
        headers: { 'content-type': speech.contentType, 'cache-control': 'private, max-age=3600' },
      });
    }

    if (req.method === 'POST' && pathname === '/api/demo/seed') {
      if (!options.demo) return json(404, {});
      const stored =
        (await sessions.get(asString((await readJson(req, maxBody)).sessionId))) ?? newSession();
      const demo = options.demo;
      return json(200, {
        sessionId: stored.id,
        ...(await withSession(stored, (s) => demo.seedHousehold(s))),
      });
    }

    if (req.method === 'POST' && pathname === '/api/demo/new-recall') {
      if (!options.demo) return json(404, {});
      const stored = await sessions.get(asString((await readJson(req, maxBody)).sessionId));
      if (!stored) return json(400, { error: 'Start a conversation first.' });
      const demo = options.demo;
      return json(
        200,
        await withSession(stored, (s) => demo.simulateNewRecall(s), { save: false }),
      );
    }

    if (req.method === 'POST' && pathname === '/api/reset') {
      const stored = await sessions.get(asString((await readJson(req, maxBody)).sessionId));
      if (stored) {
        await withSession(stored, clearHousehold, { save: false });
        await sessions.delete(stored.id);
      }
      return json(200, { ok: true });
    }

    if (req.method === 'GET') {
      const asset = options.assets[pathname === '/' ? '/index.html' : pathname];
      if (!asset) return json(404, {});
      return new Response(typeof asset.body === 'string' ? asset.body : Buffer.from(asset.body), {
        status: 200,
        headers: {
          'content-type': asset.contentType,
          // Photos and the logo never change under the same name; the page itself must stay fresh.
          'cache-control': pathname.startsWith('/img/') ? 'public, max-age=86400' : 'no-cache',
        },
      });
    }
    return json(404, {});
  }

  return async (req) => {
    try {
      return await handle(req);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      console.error('simulator error:', error instanceof Error ? error.message : error);
      return json(500, { error: 'Something went wrong. Please try again.' });
    }
  };
}
