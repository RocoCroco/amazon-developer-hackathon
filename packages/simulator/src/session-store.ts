import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Msg } from './llm.js';

/** What must survive between requests: the conversation and how many turns it has used. */
export interface StoredSession {
  id: string;
  messages: Msg[];
  turns: number;
  /** Characters already spoken (Polly) in this conversation, against its budget. */
  speechChars?: number;
}

export interface SessionStore {
  get(id: string): Promise<StoredSession | undefined>;
  put(session: StoredSession): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async get(id: string) {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : undefined;
  }
  async put(session: StoredSession) {
    this.sessions.set(session.id, structuredClone(session));
  }
  async delete(id: string) {
    this.sessions.delete(id);
  }
}

const SESSION_TTL_SECONDS = 24 * 60 * 60;

/** Conversations in the single DynamoDB table: PK=SES#<id> SK=DATA, expiring after a day. */
export class DynamoSessionStore implements SessionStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => number = Date.now,
  ) {}

  async get(id: string): Promise<StoredSession | undefined> {
    const res = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `SES#${id}`, SK: 'DATA' } }),
    );
    if (!res.Item) return undefined;
    return {
      id,
      messages: JSON.parse(res.Item.messages as string) as Msg[],
      turns: res.Item.turns as number,
      speechChars: (res.Item.speechChars as number | undefined) ?? 0,
    };
  }

  async put(session: StoredSession): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `SES#${session.id}`,
          SK: 'DATA',
          // Stored as one JSON string: the nested tool-call blocks are not worth modelling as attributes.
          messages: JSON.stringify(session.messages),
          turns: session.turns,
          speechChars: session.speechChars ?? 0,
          expiresAt: Math.floor(this.now() / 1000) + SESSION_TTL_SECONDS,
        },
      }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.send(
      new DeleteCommand({ TableName: this.tableName, Key: { PK: `SES#${id}`, SK: 'DATA' } }),
    );
  }
}

/** A counter with a daily ceiling, shared by every container (the public demo's spending guard). */
export interface DailyCap {
  /** Takes `n` units from today's allowance if they fit, and says whether they did. */
  tryUse(n: number): Promise<boolean>;
}

export class InMemoryDailyCap implements DailyCap {
  private day = '';
  private used = 0;

  constructor(
    private readonly max: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tryUse(n: number) {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used + n > this.max) return false;
    this.used += n;
    return true;
  }
}

/**
 * Atomic daily counter in DynamoDB: PK=CAP#<name>#<day> SK=COUNT. The conditional update refuses (and
 * changes nothing) when the new total would pass the ceiling, so concurrent Lambdas cannot overspend.
 */
export class DynamoDailyCap implements DailyCap {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly name: string,
    private readonly max: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tryUse(n: number): Promise<boolean> {
    const day = this.now().toISOString().slice(0, 10);
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `CAP#${this.name}#${day}`, SK: 'COUNT' },
          UpdateExpression: 'ADD #used :n SET expiresAt = :ttl',
          ConditionExpression: 'attribute_not_exists(#used) OR #used <= :room',
          ExpressionAttributeNames: { '#used': 'used' },
          ExpressionAttributeValues: {
            ':n': n,
            ':room': this.max - n,
            ':ttl': Math.floor(this.now().getTime() / 1000) + 3 * 24 * 60 * 60,
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
}
