import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../test/corpus.js';
import { InMemoryAlertStore } from './alerts.js';
import { startNodeServer } from './node-server.js';
import { fromCpsc, type CpscRecall } from './recalls/cpsc.js';
import { StaticRecallProvider } from './recalls/provider.js';
import { InMemoryItemStore } from './store.js';

let url: string;
let stop: () => Promise<void>;
const clients: Client[] = [];

beforeAll(async () => {
  const heaters = (
    JSON.parse(
      readFileSync(new URL('../test/fixtures/cpsc-space-heater.json', import.meta.url), 'utf8'),
    ) as CpscRecall[]
  ).map(fromCpsc);
  const s = await startNodeServer({
    store: new InMemoryItemStore(),
    alerts: new InMemoryAlertStore(),
    recalls: new StaticRecallProvider([...heaters, ...loadCorpus()]),
  });
  url = s.url;
  stop = s.close;
});

afterAll(async () => {
  for (const c of clients) await c.close();
  await stop();
});

async function connect(household: string) {
  const client = new Client({ name: 'alert-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-household-id': household } },
    }),
  );
  clients.push(client);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const summary = (res.content as { text: string }[])[0]!.text;
    // Tool payloads are loosely typed JSON; the tests assert on the fields they care about.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { summary, data: res.structuredContent as Record<string, any> };
  };
}

describe('the family story: register, check everything, get alerted, fix it', () => {
  const HH = 'fAmIlYsToRyFaMiLyStOrY001';

  it('check_household finds the recalled heater and asks about the car seat', async () => {
    const call = await connect(HH);
    await call('add_item', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    await call('add_item', { name: 'car seat', brand: 'Graco', model: 'SnugRide' });

    const { summary, data } = await call('check_household');
    expect(data.status).toBe('recalled');
    expect(data.checked).toBe(2);
    expect(summary).toMatch(/^Your Govee space heater is recalled\. /);
    expect(summary).toMatch(/One other item still needs a little help from you\.$/);
    expect(summary).not.toMatch(/https?:/);
    expect(data.recalled).toHaveLength(1);
    expect(data.need_info).toHaveLength(1);
  });

  it('get_alerts lists the confirmed recall first and offers to walk through the fix', async () => {
    const call = await connect(HH);
    const { summary, data } = await call('get_alerts');
    expect(data.count).toBe(2);
    expect(data.alerts[0]).toMatchObject({
      item: 'Govee space heater',
      kind: 'recalled',
      severity: 'high',
    });
    expect(data.alerts[1]).toMatchObject({ item: 'Graco car seat', kind: 'need_info' });
    expect(summary).toMatch(
      /You have one recall alert\. The most urgent is your Govee space heater\./,
    );
    expect(summary).toMatch(/Want me to walk you through the fix\?$/);
  });

  it('checking again does not duplicate alerts', async () => {
    const call = await connect(HH);
    await call('check_household');
    expect((await call('get_alerts')).data.count).toBe(2);
  });

  it('get_remedy gives the safe step first, the phone number as digits, and no link in the speech', async () => {
    const call = await connect(HH);
    const alerts = (await call('get_alerts')).data.alerts;
    const { summary, data } = await call('get_remedy', { alert_id: alerts[0].alert_id });
    expect(data.status).toBe('remedy');
    expect(data.stop_using).toBe(true);
    expect(summary).toMatch(/stop using/i);
    expect(summary).toContain('8 3 3, 7 7 2, 5 3 6 0');
    expect(summary).not.toMatch(/https?:|\.com/);
    expect(data.options).toContain('a refund');
    expect(data.recall_url).toMatch(/^https:\/\/www\.cpsc\.gov/);
    expect(data.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('get_remedy on a question-only alert asks the question instead of giving a fix', async () => {
    const call = await connect(HH);
    const alerts = (await call('get_alerts')).data.alerts;
    const { summary, data } = await call('get_remedy', { alert_id: alerts[1].alert_id });
    expect(data.status).toBe('need_info');
    expect(summary).toMatch(/not sure yet that this recall covers your Graco car seat/);
    expect(summary).toMatch(/made between/);
  });

  it('resolve_alert closes it and get_alerts moves on; closing twice says so', async () => {
    const call = await connect(HH);
    const alerts = (await call('get_alerts')).data.alerts;
    const done = await call('resolve_alert', { alert_id: alerts[0].alert_id, resolution: 'fixed' });
    expect(done.data).toMatchObject({ status: 'resolved', resolution: 'fixed', open_alerts: 1 });
    expect(done.summary).toBe(
      'Great, I marked the recall for your Govee space heater as fixed. You have one open alert left.',
    );
    const after = await call('get_alerts');
    expect(after.data.count).toBe(1);
    expect(after.data.alerts[0].item).toBe('Graco car seat');
    expect(
      (await call('resolve_alert', { alert_id: alerts[0].alert_id, resolution: 'fixed' })).data
        .status,
    ).toBe('already_resolved');
  });

  it('a fixed alert stays fixed when everything is checked again', async () => {
    const call = await connect(HH);
    await call('check_household');
    const { data } = await call('get_alerts');
    expect(data.alerts.map((a: { item: string }) => a.item)).toEqual(['Graco car seat']);
  });
});

describe('other situations', () => {
  it('has nothing to check for an empty household', async () => {
    const call = await connect('eMpTyHoUsEhOlDeMpTyHoU002');
    const { summary, data } = await call('check_household');
    expect(data.status).toBe('empty');
    expect(summary).toMatch(/haven't registered anything yet/);
    expect((await call('get_alerts')).summary).toBe('You have no open recall alerts.');
  });

  it('reports good news when nothing is recalled', async () => {
    const call = await connect('cLeArHoUsEhOlDcLeArHo003');
    await call('add_item', { name: 'desk lamp', brand: 'Govee' });
    const { summary, data } = await call('check_household');
    expect(data.status).toBe('clear');
    expect(summary).toBe('Good news: I checked one item and found no recalls.');
  });

  it('says which item it could not check because the brand is unknown', async () => {
    const call = await connect('nOrAnDnOrAnDnOrAnDnOrA004');
    await call('add_item', { name: 'car seat' });
    const { summary, data } = await call('check_household');
    expect(data.unchecked).toHaveLength(1);
    expect(summary).toMatch(/could not check your car seat because I do not know who makes it/);
  });

  it('add_item with brand and model checks right away and records the alert, so the fix can be fetched', async () => {
    const call = await connect('sAvEdCheCkSaVeDcHeCkSa005');
    const added = await call('add_item', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    expect(added.data.status).toBe('recalled');
    expect(added.summary).toMatch(/^Okay, I saved your Govee H7131 space heater\. .*is recalled/);
    // Checking again later does not duplicate the alert.
    await call('check_item', { item_id: added.data.item_id });
    const alerts = (await call('get_alerts')).data.alerts;
    expect(alerts).toHaveLength(1);
    expect((await call('get_remedy', { alert_id: alerts[0].alert_id })).data.status).toBe('remedy');
  });

  it('an ad hoc check of something not registered creates no alert', async () => {
    const call = await connect('aDhOcCheCkAdHoCcHeCkAd006');
    await call('check_item', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    expect((await call('get_alerts')).data.count).toBe(0);
  });

  it('does not show or let one household touch another household alerts', async () => {
    const a = await connect('hOuSeAlErThOuSeAlErThO007');
    const b = await connect('hOuSeBlErThOuSeBlErThO008');
    await a('add_item', { name: 'space heater', brand: 'Govee', model: 'H7131' });
    await a('check_household');
    const alertId = (await a('get_alerts')).data.alerts[0].alert_id;
    expect((await b('get_alerts')).data.count).toBe(0);
    expect((await b('get_remedy', { alert_id: alertId })).data.status).toBe('not_found');
    expect(
      (await b('resolve_alert', { alert_id: alertId, resolution: 'dismissed' })).data.status,
    ).toBe('not_found');
    expect((await a('get_alerts')).data.count).toBe(1);
  });

  it('answers not found for unknown alert ids', async () => {
    const call = await connect('uNkNoWnAlErTuNkNoWnAlE009');
    expect((await call('get_remedy', { alert_id: 'nope' })).data.status).toBe('not_found');
    expect(
      (await call('resolve_alert', { alert_id: 'nope', resolution: 'fixed' })).data.status,
    ).toBe('not_found');
  });
});

describe('a brand misheard by speech recognition (the human tester said "Aitjunz", the browser wrote "8th June")', () => {
  it('asks to confirm by sound and spelling, accepts a spelled correction, then finds the recall', async () => {
    const call = await connect('pHoNeTiCpHoNeTiCpHoNe009');
    const added = await call('add_item', { name: '8-drawer dresser', brand: '8th June' });
    expect(added.data.status).toBe('need_info');
    expect(added.data.options).toEqual(['Aitjunz']);
    expect(added.summary).toBe(
      'Okay, I saved your 8th June 8-drawer dresser. Just to be sure I heard the brand right: do you mean ' +
        'Aitjunz, A-I-T-J-U-N-Z? If not, you can spell the brand for me, letter by letter.',
    );

    // The owner spells it; the recognizer writes single letters.
    const spelled = await call('update_item', {
      item_id: added.data.item_id,
      brand: 'A I T J U N Z',
    });
    expect(spelled.data.brand).toBe('AITJUNZ');
    expect(spelled.summary).toMatch(/models are recalled, so I need your model number/);

    const model = await call('update_item', { item_id: added.data.item_id, model: 'LDQMFJ8D-BK' });
    expect(model.data.status).toBe('recalled');
    expect(model.summary).toMatch(/is recalled/);
  });

  it('with the model already given, check_item asks the same question instead of "no recalls"', async () => {
    const call = await connect('pHoNeTiCpHoNeTiCpHoNe010');
    const res = await call('check_item', {
      name: 'dresser',
      brand: 'iTunes',
      model: 'LDQMFJ8D-BK',
    });
    expect(res.data.status).toBe('need_info');
    expect(res.summary).toMatch(/Do you mean Aitjunz, A-I-T-J-U-N-Z\?/);
  });

  it('"a new Aitjunz dresser", no model: says some are recalled before asking for the hard-to-find model', async () => {
    const call = await connect('nOmOdElNoMoDeLnOmOdEl012');
    const added = await call('add_item', { name: 'dresser', brand: 'Aitjunz' });
    expect(added.data.status).toBe('need_info');
    expect(added.summary).toMatch(
      /^Okay, I saved your Aitjunz dresser\. Some Aitjunz dresser models are recalled, so I need your model number\./,
    );
    // The open question is on the panel (amber), until the model says yes or no.
    expect((await call('get_alerts')).data.count).toBe(1);
  });

  it('a brand that sounds like no recalled brand is simply saved', async () => {
    const call = await connect('pHoNeTiCpHoNeTiCpHoNe011');
    const added = await call('add_item', { name: 'dresser', brand: 'Hemnes' });
    expect(added.summary).toMatch(
      // Nothing like it is recalled: no hard questions, just keep watching.
      /^Okay, I saved your Hemnes dresser\. I found no recalls for Hemnes dresser products like this, so there is nothing more you need to look up\./,
    );
  });
});
