import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Item } from '../matcher/match.js';
import { normalizeBrand } from '../matcher/normalize.js';
import {
  brandKeys,
  fingerprint,
  nameWords,
  productWords,
  type RecallStore,
  type SourceId,
  type UpsertResult,
} from './cache.js';
import type { Recall } from './types.js';

/** Recalls are kept about a year: long enough to match late-registered items, short enough to stay tiny. */
const RECALL_TTL_SECONDS = 400 * 24 * 60 * 60;
const MAX_CANDIDATES = 300;
const MIN_WORD = 3;

const recallKey = (id: string) => `RCL#${id}`;
const brandPartition = (word: string) => `BRAND#${word}`;
const productPartition = (word: string) => `PRODUCT#${word}`;
const BATCH_GET_LIMIT = 100;
const UPSERT_CONCURRENCY = 8;

interface RecallRecord {
  PK: string;
  SK: 'DATA';
  hash: string;
  recall: Recall;
  expiresAt: number;
}

/** Index words for a recall: every word (3+ letters) of each normalized brand it names. */
export function brandWords(recall: Recall): string[] {
  return [
    ...new Set(
      brandKeys(recall)
        .flatMap((key) => key.split(' '))
        .filter((w) => w.length >= MIN_WORD),
    ),
  ];
}

/**
 * Recall cache in the same single table as the inventory.
 *   PK=RCL#<id>      SK=DATA        the recall, with a content hash to tell revisions from re-fetches
 *   PK=BRAND#<word>  SK=RCL#<id>    index: which recalls name a brand containing this word
 *   PK=PRODUCT#<word> SK=RCL#<id>   index: which recalls are about this kind of product ("dresser")
 *   PK=CURSOR        SK=<source>    date up to which a feed has been synced
 */
export class DynamoRecallStore implements RecallStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => number = Date.now,
  ) {}

  async getCursor(source: SourceId): Promise<string | undefined> {
    const res = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: 'CURSOR', SK: source } }),
    );
    return res.Item?.date as string | undefined;
  }

  async setCursor(source: SourceId, isoDate: string): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: 'CURSOR', SK: source, date: isoDate },
      }),
    );
  }

  async upsert(recalls: Recall[], options: { reindex?: boolean } = {}): Promise<UpsertResult> {
    const result: UpsertResult = { added: [], updated: [], unchanged: 0 };
    const expiresAt = Math.floor(this.now() / 1000) + RECALL_TTL_SECONDS;
    // A few recalls at a time: a backfill writes thousands, one by one would take many minutes.
    for (let i = 0; i < recalls.length; i += UPSERT_CONCURRENCY) {
      await Promise.all(
        recalls
          .slice(i, i + UPSERT_CONCURRENCY)
          .map((recall) => this.upsertOne(recall, expiresAt, result, options)),
      );
    }
    return result;
  }

  private async upsertOne(
    recall: Recall,
    expiresAt: number,
    result: UpsertResult,
    options: { reindex?: boolean },
  ): Promise<void> {
    const hash = fingerprint(recall);
    const known = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: recallKey(recall.id), SK: 'DATA' },
      }),
    );
    const knownHash = (known.Item as RecallRecord | undefined)?.hash;
    if (knownHash === hash) {
      result.unchanged += 1;
      if (options.reindex) await this.index(recall, expiresAt);
      return;
    }
    if (knownHash === undefined) result.added.push(recall);
    else result.updated.push(recall);

    const record: RecallRecord = {
      PK: recallKey(recall.id),
      SK: 'DATA',
      hash,
      recall,
      expiresAt,
    };
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: record }));
    if (knownHash === undefined || options.reindex) await this.index(recall, expiresAt);
  }

  private async index(recall: Recall, expiresAt: number): Promise<void> {
    const partitions = [
      ...brandWords(recall).map(brandPartition),
      ...productWords(recall).map(productPartition),
    ];
    for (const pk of partitions) {
      await this.db.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { PK: pk, SK: recallKey(recall.id), expiresAt },
        }),
      );
    }
  }

  async candidates(item: Item): Promise<Recall[]> {
    const brand = item.brand ? normalizeBrand(item.brand) : '';
    const partitions = [...new Set(brand.split(' ').filter((w) => w.length >= MIN_WORD))].map(
      brandPartition,
    );
    partitions.push(...[...new Set(nameWords(item.name ?? ''))].map(productPartition));
    if (partitions.length === 0) return [];

    // Brand hits first: they are the ones the matcher can confirm.
    const ids = new Set<string>();
    for (const pk of partitions) {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'RCL#' },
          Limit: MAX_CANDIDATES,
        }),
      );
      for (const row of res.Items ?? []) ids.add(String(row.SK));
    }

    const keys = [...ids].slice(0, MAX_CANDIDATES).map((sk) => ({ PK: sk, SK: 'DATA' }));
    const recalls: Recall[] = [];
    for (let i = 0; i < keys.length; i += BATCH_GET_LIMIT) {
      let request: Record<string, { Keys: Record<string, string>[] }> | undefined = {
        [this.tableName]: { Keys: keys.slice(i, i + BATCH_GET_LIMIT) },
      };
      // DynamoDB may return part of a batch as UnprocessedKeys: ask again for those (a few times at most).
      for (let attempt = 0; request && attempt < 4; attempt++) {
        const res: BatchGetCommandOutput = await this.db.send(
          new BatchGetCommand({ RequestItems: request }),
        );
        for (const row of res.Responses?.[this.tableName] ?? []) {
          recalls.push((row as RecallRecord).recall);
        }
        const rest: Record<string, unknown>[] | undefined =
          res.UnprocessedKeys?.[this.tableName]?.Keys;
        request = rest?.length
          ? { [this.tableName]: { Keys: rest as Record<string, string>[] } }
          : undefined;
      }
    }
    return recalls;
  }
}
