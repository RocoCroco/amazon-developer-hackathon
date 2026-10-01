import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  compareAlerts,
  mergeAlert,
  type Alert,
  type AlertStatus,
  type AlertStore,
  type Resolution,
  type UpsertAlertResult,
} from './alerts.js';

/** Alerts expire (DynamoDB TTL) so demo data never piles up. */
const ALERT_TTL_SECONDS = 180 * 24 * 60 * 60;

const hhKey = (householdId: string) => `HH#${householdId}`;
const alertKey = (alertId: string) => `ALERT#${alertId}`;

interface AlertRecord extends Alert {
  PK: string;
  SK: string;
  expiresAt: number;
}

/** Drops the storage-only attributes (keys, TTL). */
function toAlert(record: AlertRecord): Alert {
  const { PK: _pk, SK: _sk, expiresAt: _ttl, ...alert } = record;
  void _pk;
  void _sk;
  void _ttl;
  return alert;
}

/**
 * Single-table design, same table as the inventory:  PK=HH#<householdId>  SK=ALERT#<alertId>.
 * The alert id is derived from item + recall, so the same recall never creates a second alert.
 */
export class DynamoAlertStore implements AlertStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => number = Date.now,
  ) {}

  private async put(householdId: string, alert: Alert): Promise<void> {
    const record: AlertRecord = {
      ...alert,
      PK: hhKey(householdId),
      SK: alertKey(alert.id),
      expiresAt: Math.floor(this.now() / 1000) + ALERT_TTL_SECONDS,
    };
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: record }));
  }

  async getAlert(householdId: string, alertId: string): Promise<Alert | undefined> {
    const res = await this.db.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: hhKey(householdId), SK: alertKey(alertId) },
      }),
    );
    return res.Item ? toAlert(res.Item as AlertRecord) : undefined;
  }

  async upsertAlert(householdId: string, alert: Alert): Promise<UpsertAlertResult> {
    const result = mergeAlert(await this.getAlert(householdId, alert.id), alert);
    await this.put(householdId, result.alert);
    return result;
  }

  async listAlerts(householdId: string, status?: AlertStatus): Promise<Alert[]> {
    const alerts: Alert[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': hhKey(householdId), ':sk': 'ALERT#' },
          ExclusiveStartKey: startKey,
        }),
      );
      alerts.push(...((res.Items ?? []) as AlertRecord[]).map(toAlert));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return alerts.filter((a) => !status || a.status === status).sort(compareAlerts);
  }

  async resolveAlert(
    householdId: string,
    alertId: string,
    resolution: Resolution,
    now = new Date(),
  ): Promise<Alert | undefined> {
    const alert = await this.getAlert(householdId, alertId);
    if (!alert) return undefined;
    const resolved: Alert = {
      ...alert,
      status: 'resolved',
      resolution,
      resolvedAt: now.toISOString(),
    };
    await this.put(householdId, resolved);
    return resolved;
  }
}
