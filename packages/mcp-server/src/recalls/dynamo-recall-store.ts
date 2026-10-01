import {
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

  async upsert(recalls: Recall[]): Promise<UpsertResult> {
    const result: UpsertResult = { added: [], updated: [], unchanged: 0 };
    const expiresAt = Math.floor(this.now() / 1000) + RECALL_TTL_SECONDS;
    for (const recall of recalls) {
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
        continue;
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
      if (knownHash === undefined) {
        for (const word of brandWords(recall)) {
          await this.db.send(
            new PutCommand({
              TableName: this.tableName,
              Item: { PK: brandPartition(word), SK: recallKey(recall.id), expiresAt },
            }),
          );
        }
      }
    }
    return result;
  }

  async candidates(item: Item): Promise<Recall[]> {
    const brand = item.brand ? normalizeBrand(item.brand) : '';
    const words = [...new Set(brand.split(' ').filter((w) => w.length >= MIN_WORD))];
    if (words.length === 0) return [];

    const ids = new Set<string>();
    for (const word of words) {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': brandPartition(word), ':sk': 'RCL#' },
          Limit: MAX_CANDIDATES,
        }),
      );
      for (const row of res.Items ?? []) ids.add(String(row.SK));
    }

    const recalls: Recall[] = [];
    for (const sk of [...ids].slice(0, MAX_CANDIDATES)) {
      const res = await this.db.send(
        new GetCommand({ TableName: this.tableName, Key: { PK: sk, SK: 'DATA' } }),
      );
      if (res.Item) recalls.push((res.Item as RecallRecord).recall);
    }
    return recalls;
  }
}
