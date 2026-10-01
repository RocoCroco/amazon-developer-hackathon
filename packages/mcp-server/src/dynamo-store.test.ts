import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDocClient, DynamoItemStore, newHouseholdId } from './dynamo-store.js';

const ddb = mockClient(DynamoDBDocumentClient);
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const NOW = Date.parse('2026-10-01T12:00:00Z');
const store = new DynamoItemStore(db, 'test-table', () => NOW);

beforeEach(() => ddb.reset());

describe('newHouseholdId', () => {
  it('is 22 base64url characters (128 bits) and unique', () => {
    const a = newHouseholdId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newHouseholdId()).not.toBe(a);
  });
});

describe('createDocClient', () => {
  it('removes undefined values when marshalling', () => {
    const opts = createDocClient().config.translateConfig?.marshallOptions;
    expect(opts?.removeUndefinedValues).toBe(true);
  });
});

describe('DynamoItemStore', () => {
  it('writes items under the household partition with a TTL', async () => {
    ddb.on(PutCommand).resolves({});
    const item = await store.addItem('hh1', { name: 'car seat', brand: 'Graco' });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.TableName).toBe('test-table');
    expect(put.Item).toMatchObject({
      PK: 'HH#hh1',
      SK: `ITEM#${item.id}`,
      name: 'car seat',
      brand: 'Graco',
      createdAt: '2026-10-01T12:00:00.000Z',
    });
    expect(put.Item!.expiresAt).toBe(Math.floor(NOW / 1000) + 180 * 86400);
    expect(item).not.toHaveProperty('PK');
  });

  it('lists a household items, hides storage keys, and follows pagination', async () => {
    const rec = (id: string, at: string) => ({
      PK: 'HH#hh1',
      SK: `ITEM#${id}`,
      expiresAt: 1,
      id,
      name: id,
      createdAt: at,
    });
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [rec('b', '2026-10-01T00:00:02Z')], LastEvaluatedKey: { PK: 'x' } })
      .resolvesOnce({ Items: [rec('a', '2026-10-01T00:00:01Z')] });
    const items = await store.listItems('hh1');
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(items[0]).not.toHaveProperty('PK');
    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'HH#hh1',
      ':sk': 'ITEM#',
    });
  });

  it('gets one item by key, or undefined', async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({
        Item: {
          PK: 'HH#hh1',
          SK: 'ITEM#i1',
          expiresAt: 1,
          id: 'i1',
          name: 'heater',
          createdAt: 'x',
        },
      })
      .resolvesOnce({});
    expect((await store.getItem('hh1', 'i1'))?.name).toBe('heater');
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({
      PK: 'HH#hh1',
      SK: 'ITEM#i1',
    });
    expect(await store.getItem('hh1', 'missing')).toBeUndefined();
  });
});
