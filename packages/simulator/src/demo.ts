import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { Session } from './agent.js';
import type { DemoControls } from './server.js';

/** The recall shape the watcher accepts as a seed (same JSON as the MCP server's `Recall`). */
export interface SeedRecall {
  id: string;
  source: 'cpsc' | 'nhtsa' | 'fda';
  sourceId: string;
  category: 'consumer' | 'car_seat';
  title: string;
  summary: string;
  hazard: string;
  remedy: string;
  remedyOptions: ('repair' | 'replace' | 'refund')[];
  contact: string;
  url: string;
  publishedAt: string;
  brands: string[];
  products: { name: string; models: string[] }[];
  years: number[];
  manufacturedFrom?: string;
  manufacturedTo?: string;
  severity: 'high';
}

/** Runs the watcher with a seeded recall; resolves with how many alerts it created. */
export type WatcherInvoker = (seed: SeedRecall[]) => Promise<{ alertsCreated: number }>;

/**
 * The sample family of the demo story (docs/process/video-script.md): a second-hand heater with a REAL, existing
 * CPSC recall, and a hand-me-down car seat that has no recall in the official data, so the simulated recall
 * of the story is the only alert it ever gets.
 */
export const DEMO_FAMILY = [
  { name: 'space heater', brand: 'Govee', model: 'H7131' },
  { name: 'car seat', brand: 'Chicco', model: 'KeyFit 30', year: 2023 },
] as const;

interface Item {
  item_id: string;
  name: string;
  brand?: string;
  model?: string;
  year?: number;
}

/** A clearly labeled "(demo)" recall for an item, as if the agency had just published it. */
export function demoRecallFor(item: Item, now: Date = new Date()): SeedRecall {
  const stamp = now.getTime();
  const brand = item.brand ?? 'Acme';
  const product = `${brand} ${item.model ? `${item.model} ` : ''}${item.name}`;
  const isSeat = /seat/i.test(item.name) && !!item.year;
  const base = {
    id: `demo:${stamp}`,
    sourceId: `demo-${stamp}`,
    title: `${brand} ${item.name}s recalled due to a harness defect (demo)`,
    summary: `This recall involves ${product}s. This is a simulated recall for the Recall Guardian demo.`,
    hazard: 'The harness can fail to latch, increasing the risk of injury in a crash.',
    remedy:
      'Stop using the recalled product and contact the company for a free replacement harness kit.',
    remedyOptions: ['replace' as const],
    contact: `Call ${brand} toll-free at 800-555-0142 for your free replacement kit.`,
    url: 'https://www.nhtsa.gov/recalls',
    publishedAt: now.toISOString().slice(0, 10),
    brands: [brand],
    products: [{ name: `${product}s`, models: item.model ? [item.model] : [] }],
    years: [],
    severity: 'high' as const,
  };
  return isSeat
    ? {
        ...base,
        source: 'nhtsa',
        category: 'car_seat',
        // Production window of the recalled seats: whole calendar years around the item's year.
        manufacturedFrom: `${item.year! - 1}-01-01`,
        manufacturedTo: `${item.year! + 1}-12-31`,
      }
    : { ...base, source: 'cpsc', category: 'consumer' };
}

interface Alert {
  item?: string;
  kind?: string;
}

/** Demo buttons: load the sample family, and publish a new recall for something the family owns. */
export function createDemoControls(
  invoke: WatcherInvoker,
  now: () => Date = () => new Date(),
): DemoControls {
  return {
    async seedHousehold(session: Session) {
      for (const item of DEMO_FAMILY) await session.tool('add_item', { ...item });
      return {
        ok: true,
        message: 'Added a Govee space heater and a Chicco car seat to your household.',
      };
    },

    async simulateNewRecall(session: Session) {
      const items = ((await session.tool('list_items')).items ?? []) as Item[];
      const alerts = ((await session.tool('get_alerts')).alerts ?? []) as Alert[];
      const recalled = new Set(alerts.filter((a) => a.kind === 'recalled').map((a) => a.item));
      // Prefer something with a brand and model that has no confirmed recall yet (the car seat, in the story).
      const target =
        items.find((i) => i.brand && i.model && !recalled.has([i.brand, i.name].join(' '))) ??
        items.find((i) => i.brand);
      if (!target) {
        return {
          ok: false,
          message: 'Register something with a brand first, then simulate a new recall for it.',
        };
      }
      const result = await invoke([demoRecallFor(target, now())]);
      return {
        ok: result.alertsCreated > 0,
        message:
          result.alertsCreated > 0
            ? `A new recall was published for your ${target.brand} ${target.name}. The daily watcher matched it.`
            : 'The watcher ran but found nothing new for your household.',
      };
    },
  };
}

/** Invokes the deployed watcher Lambda (needs lambda:InvokeFunction). */
export function lambdaWatcherInvoker(
  functionName: string,
  client: LambdaClient = new LambdaClient({ region: 'us-east-1' }),
): WatcherInvoker {
  return async (seed) => {
    const res = await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: Buffer.from(JSON.stringify({ seed })),
      }),
    );
    const body = JSON.parse(Buffer.from(res.Payload ?? '{}').toString('utf8')) as {
      alertsCreated?: number;
      errorMessage?: string;
    };
    if (res.FunctionError || body.errorMessage) {
      throw new Error(`Watcher failed: ${body.errorMessage ?? res.FunctionError}`);
    }
    return { alertsCreated: body.alertsCreated ?? 0 };
  };
}
