import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { DynamoItemStore } from './dynamo-store.js';
import { InMemoryItemStore, type ItemStore } from './store.js';

/**
 * Both stores must behave the same. DynamoDB is exercised through a tiny in-memory fake of the table,
 * wired into the mocked document client, so the same contract tests run against both.
 */
const ddb = mockClient(DynamoDBDocumentClient);
type Rec = Record<string, unknown>;
const table = new Map<string, Rec>();
const keyOf = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;

function wireFakeTable(): void {
  table.clear();
  ddb.reset();
  ddb.on(PutCommand).callsFake((input) => {
    table.set(keyOf(input.Item), { ...input.Item });
    return {};
  });
  ddb.on(GetCommand).callsFake((input) => ({ Item: table.get(keyOf(input.Key)) }));
  ddb.on(QueryCommand).callsFake((input) => ({
    Items: [...table.values()].filter(
      (r) => r.PK === input.ExpressionAttributeValues[':pk'] && String(r.SK).startsWith('ITEM#'),
    ),
  }));
  ddb.on(UpdateCommand).callsFake((input) => {
    const existing = table.get(keyOf(input.Key));
    if (!existing) {
      throw new ConditionalCheckFailedException({ message: 'missing', $metadata: {} });
    }
    const updated = { ...existing };
    for (const [placeholder, attribute] of Object.entries(
      input.ExpressionAttributeNames as Record<string, string>,
    )) {
      const valueKey = ':v' + placeholder.slice(2);
      updated[attribute] = (input.ExpressionAttributeValues as Rec)[valueKey];
    }
    table.set(keyOf(input.Key), updated);
    return { Attributes: updated };
  });
  ddb.on(DeleteCommand).callsFake((input) => {
    const old = table.get(keyOf(input.Key));
    table.delete(keyOf(input.Key));
    return { Attributes: old };
  });
}

const dynamo = () =>
  new DynamoItemStore(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })),
    't',
  );

const stores: [string, () => ItemStore][] = [
  ['InMemoryItemStore', () => new InMemoryItemStore()],
  ['DynamoItemStore (fake table)', dynamo],
];

for (const [name, make] of stores) {
  describe(`${name} contract`, () => {
    let store: ItemStore;
    beforeEach(() => {
      wireFakeTable();
      store = make();
    });

    it('adds, gets and lists items per household', async () => {
      const a = await store.addItem('hh1', { name: 'car seat', brand: 'Graco' });
      await store.addItem('hh2', { name: 'heater' });
      expect((await store.getItem('hh1', a.id))?.brand).toBe('Graco');
      expect((await store.listItems('hh1')).map((i) => i.id)).toEqual([a.id]);
      expect(await store.getItem('hh2', a.id)).toBeUndefined();
    });

    it('updates only the fields given and returns the new item', async () => {
      const a = await store.addItem('hh1', { name: 'car seat', brand: 'Graco', year: 2012 });
      const updated = await store.updateItem('hh1', a.id, {
        model: 'SnugRide',
        month: 6,
        brand: undefined,
      });
      expect(updated).toMatchObject({
        id: a.id,
        name: 'car seat',
        brand: 'Graco',
        model: 'SnugRide',
        year: 2012,
        month: 6,
      });
      expect(await store.getItem('hh1', a.id)).toEqual(updated);
    });

    it('can change a reserved-word attribute like name', async () => {
      const a = await store.addItem('hh1', { name: 'seat' });
      expect((await store.updateItem('hh1', a.id, { name: 'booster seat' }))?.name).toBe(
        'booster seat',
      );
    });

    it('returns the item unchanged for an empty patch', async () => {
      const a = await store.addItem('hh1', { name: 'seat' });
      expect((await store.updateItem('hh1', a.id, {}))?.name).toBe('seat');
    });

    it('does not update an item that does not exist or belongs to another household', async () => {
      const a = await store.addItem('hh1', { name: 'seat' });
      expect(await store.updateItem('hh1', 'nope', { name: 'x' })).toBeUndefined();
      expect(await store.updateItem('hh2', a.id, { name: 'x' })).toBeUndefined();
      expect((await store.getItem('hh1', a.id))?.name).toBe('seat');
    });

    it('removes an item once, and only from its own household', async () => {
      const a = await store.addItem('hh1', { name: 'seat' });
      expect(await store.removeItem('hh2', a.id)).toBe(false);
      expect(await store.removeItem('hh1', a.id)).toBe(true);
      expect(await store.removeItem('hh1', a.id)).toBe(false);
      expect(await store.listItems('hh1')).toEqual([]);
    });
  });
}
