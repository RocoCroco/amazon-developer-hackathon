import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createDemoControls, lambdaWatcherInvoker } from './demo.js';
import { createSimulatorHandler, type Asset } from './handler.js';
import { BedrockLlm } from './llm.js';
import { RuleBasedLlm } from './mock-brain.js';
import { DynamoDailyCap, DynamoSessionStore } from './session-store.js';
import { PollySpeaker } from './speech.js';
import { UI_ASSETS } from './ui-assets.generated.js';

/** The parts of a Lambda Function URL event (payload v2) that we use. */
export interface FunctionUrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

type Handler = (req: Request) => Promise<Response>;

export function eventToRequest(event: FunctionUrlEvent): Request {
  const method = event.requestContext.http.method;
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers)) {
    if (value !== undefined) headers.set(name, value);
  }
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const hasBody = method !== 'GET' && method !== 'HEAD' && event.body !== undefined;
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64')
      : (event.body ?? '')
    : undefined;
  return new Request(`https://lambda.invalid${event.rawPath}${query}`, { method, headers, body });
}

/** Text answers go out as text; audio (Polly MP3) must be base64 encoded for a Function URL. */
export async function responseToResult(res: Response): Promise<FunctionUrlResult> {
  const headers = Object.fromEntries(res.headers);
  const binary = /^(audio|image|application\/octet-stream)/.test(headers['content-type'] ?? '');
  const bytes = Buffer.from(await res.arrayBuffer());
  return binary
    ? { statusCode: res.status, headers, body: bytes.toString('base64'), isBase64Encoded: true }
    : { statusCode: res.status, headers, body: bytes.toString('utf8') };
}

async function readDemoKey(paramName: string): Promise<string> {
  const res = await new SSMClient({ region: 'us-east-1' }).send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${paramName} is empty`);
  return value;
}

function decodeAssets(): Record<string, Asset> {
  return Object.fromEntries(
    Object.entries(UI_ASSETS).map(([route, { contentType, body, base64 }]) => [
      route,
      { contentType, body: base64 ? Buffer.from(body, 'base64') : body },
    ]),
  );
}

let cached: Promise<Handler> | undefined;

/** Built once per container: wires DynamoDB sessions and caps, Bedrock, Polly and the watcher. */
function getHandler(): Promise<Handler> {
  cached ??= (async () => {
    const { MCP_URL, TABLE_NAME, DEMO_KEY_PARAM, WATCHER_FUNCTION } = process.env;
    if (!MCP_URL || !TABLE_NAME || !DEMO_KEY_PARAM) {
      throw new Error('MCP_URL, TABLE_NAME and DEMO_KEY_PARAM must be set');
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    return createSimulatorHandler({
      mcp: { url: MCP_URL, demoKey: await readDemoKey(DEMO_KEY_PARAM) },
      llm: () => (process.env.SIM_LLM === 'mock' ? new RuleBasedLlm() : new BedrockLlm()),
      assets: decodeAssets(),
      sessions: new DynamoSessionStore(db, TABLE_NAME),
      speaker: new PollySpeaker(),
      // Spending guards shared by every container (see docs/costs.md): model turns and spoken characters.
      turnCap: new DynamoDailyCap(db, TABLE_NAME, 'turns', Number(process.env.DAILY_TURNS ?? 600)),
      speechCap: new DynamoDailyCap(
        db,
        TABLE_NAME,
        'speech',
        Number(process.env.DAILY_SPEECH_CHARS ?? 120_000),
      ),
      demo: WATCHER_FUNCTION
        ? createDemoControls(lambdaWatcherInvoker(WATCHER_FUNCTION))
        : undefined,
    });
  })();
  return cached;
}

const misconfigured: Handler = async () =>
  new Response('{"error":"server misconfigured"}', {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const h = await getHandler().catch((error: unknown) => {
    console.error('simulator failed to start:', error instanceof Error ? error.message : error);
    return misconfigured;
  });
  return responseToResult(await h(eventToRequest(event)));
}
