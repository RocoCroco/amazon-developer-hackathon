import { randomBytes, randomUUID } from 'node:crypto';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  definedFields,
  type ItemPatch,
  type ItemStore,
  type NewItem,
  type StoredItem,
} from './store.js';

/** Items expire (DynamoDB TTL) so demo data never piles up. */
const ITEM_TTL_SECONDS = 180 * 24 * 60 * 60;

/** Document client for us-east-1 that drops `undefined` attributes instead of throwing. */
export function createDocClient(region = 'us-east-1'): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/** New unguessable household ID: 128 random bits as 22 base64url characters. */
export function newHouseholdId(): string {
  return randomBytes(16).toString('base64url');
}

const hhKey = (householdId: string) => `HH#${householdId}`;
const itemKey = (itemId: string) => `ITEM#${itemId}`;

interface ItemRecord extends StoredItem {
  PK: string;
  SK: string;
  expiresAt: number;
}

/** Drops the storage-only attributes (keys, TTL). */
function toStored(record: ItemRecord): StoredItem {
  const { id, createdAt, name, brand, model, year, month } = record;
  const item: StoredItem = { id, createdAt, name };
  if (brand !== undefined) item.brand = brand;
  if (model !== undefined) item.model = model;
  if (year !== undefined) item.year = year;
  if (month !== undefined) item.month = month;
  return item;
}

/**
 * Single-table design (table keys PK/SK, TTL attribute `expiresAt`):
 *   PK=HH#<householdId>  SK=ITEM#<itemId>   inventory items
 * Alerts and the recall cache get their own SK prefixes later.
 */
export class DynamoItemStore implements ItemStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => number = Date.now,
  ) {}

  async addItem(householdId: string, item: NewItem): Promise<StoredItem> {
    const stored: StoredItem = {
      ...item,
      id: randomUUID(),
      createdAt: new Date(this.now()).toISOString(),
    };
    const record: ItemRecord = {
      ...stored,
      PK: hhKey(householdId),
      SK: itemKey(stored.id),
      expiresAt: Math.floor(this.now() / 1000) + ITEM_TTL_SECONDS,
    };
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: record }));
    return stored;
  }

  async listItems(householdId: string): Promise<StoredItem[]> {
    const items: StoredItem[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': hhKey(householdId), ':sk': 'ITEM#' },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...((res.Items ?? []) as ItemRecord[]).map(toStored));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getItem(householdId: string, itemId: string): Promise<StoredItem | undefined> {
    const res = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: hhKey(householdId), SK: itemKey(itemId) },
      }),
    );
    return res.Item ? toStored(res.Item as ItemRecord) : undefined;
  }

  async updateItem(
    householdId: string,
    itemId: string,
    patch: ItemPatch,
  ): Promise<StoredItem | undefined> {
    const fields = Object.entries(definedFields(patch));
    if (fields.length === 0) return this.getItem(householdId, itemId);
    try {
      const res = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: hhKey(householdId), SK: itemKey(itemId) },
          // Attribute names go through placeholders: `name` is a DynamoDB reserved word.
          UpdateExpression: `SET ${fields.map(([,], i) => `#f${i} = :v${i}`).join(', ')}`,
          ExpressionAttributeNames: Object.fromEntries(fields.map(([k], i) => [`#f${i}`, k])),
          ExpressionAttributeValues: Object.fromEntries(fields.map(([, v], i) => [`:v${i}`, v])),
          ConditionExpression: 'attribute_exists(PK)',
          ReturnValues: 'ALL_NEW',
        }),
      );
      return res.Attributes ? toStored(res.Attributes as ItemRecord) : undefined;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return undefined;
      throw error;
    }
  }

  async removeItem(householdId: string, itemId: string): Promise<boolean> {
    const res = await this.db.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: hhKey(householdId), SK: itemKey(itemId) },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return res.Attributes !== undefined;
  }
}
