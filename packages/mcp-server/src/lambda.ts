import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoAlertStore } from './dynamo-alerts.js';
import { createDocClient, DynamoItemStore } from './dynamo-store.js';
import { createMcpHandler } from './handler.js';
import { DynamoRecallStore } from './recalls/dynamo-recall-store.js';
import { CpscRecallProvider } from './recalls/provider.js';
import {
  CompositeRecallProvider,
  NhtsaVehicleProvider,
  StoreRecallProvider,
} from './recalls/providers.js';

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
}

type McpHandler = (req: Request) => Promise<Response>;

/** Function URL event -> web `Request`. */
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

/** web `Response` -> Function URL result. */
export async function responseToResult(res: Response): Promise<FunctionUrlResult> {
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers),
    body: await res.text(),
  };
}

/** Routes POST/GET/DELETE /mcp to the handler; everything else is 404. */
export async function handleEvent(
  event: FunctionUrlEvent,
  mcp: McpHandler,
): Promise<FunctionUrlResult> {
  if (event.rawPath !== '/mcp') {
    return { statusCode: 404, headers: { 'content-type': 'application/json' }, body: '{}' };
  }
  return responseToResult(await mcp(eventToRequest(event)));
}

let cached: Promise<McpHandler> | undefined;

async function readDemoKey(paramName: string): Promise<string> {
  const res = await new SSMClient({ region: 'us-east-1' }).send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${paramName} is empty`);
  return value;
}

/** Built once per Lambda container: reads the demo key from SSM (never from code or env values). */
function getHandler(): Promise<McpHandler> {
  cached ??= (async () => {
    const table = process.env.TABLE_NAME;
    const keyParam = process.env.DEMO_KEY_PARAM;
    if (!table || !keyParam) throw new Error('TABLE_NAME and DEMO_KEY_PARAM must be set');
    const db = createDocClient();
    return createMcpHandler({
      store: new DynamoItemStore(db, table),
      alerts: new DynamoAlertStore(db, table),
      // Live CPSC (consumer products) + live NHTSA lookup (vehicles) + the cache the daily watcher keeps
      // (child seats, equipment, tires, food, drugs).
      recalls: new CompositeRecallProvider(
        [
          new CpscRecallProvider(),
          new NhtsaVehicleProvider(),
          // The cache holds a copy of CPSC (daily sync + backfill), so a CPSC outage is covered.
          new StoreRecallProvider(new DynamoRecallStore(db, table), ['CPSC']),
        ],
        (error) =>
          console.warn('recall source failed:', error instanceof Error ? error.message : error),
      ),
      demoKey: await readDemoKey(keyParam),
    });
  })();
  return cached;
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  return handleEvent(event, await getHandler().catch(() => failedHandler));
}

const failedHandler: McpHandler = async () =>
  new Response('{"error":"server misconfigured"}', {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
