import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

/** SSM SecureString holding the shared demo key. Created by hand, never by CDK or committed. */
export const DEMO_KEY_PARAM = '/recall-guardian/demo-key';

/** Repo root = nearest ancestor holding package-lock.json (works from source and from dist/). */
function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, 'package-lock.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('package-lock.json not found');
    dir = parent;
  }
  return dir;
}

const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const lambdaEntry = path.join(repoRoot, 'packages/mcp-server/src/lambda.ts');
const watcherEntry = path.join(repoRoot, 'packages/mcp-server/src/watcher-lambda.ts');
const simulatorEntry = path.join(repoRoot, 'packages/simulator/src/lambda.ts');
const lockFile = path.join(repoRoot, 'package-lock.json');

export class RecallGuardianStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // On-demand table; items expire through the `expiresAt` TTL attribute. Demo data: safe to destroy.
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const mcpFunction = new NodejsFunction(this, 'McpFunction', {
      entry: lambdaEntry,
      depsLockFilePath: lockFile,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 50,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'McpLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: { TABLE_NAME: table.tableName, DEMO_KEY_PARAM },
      bundling: { minify: true, sourceMap: false },
    });
    table.grantReadWriteData(mcpFunction);
    mcpFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: DEMO_KEY_PARAM.slice(1),
          }),
        ],
      }),
    );

    // Public HTTPS endpoint; the demo key is checked in code (Function URLs have no throttling).
    const url = mcpFunction.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // Daily watcher: pulls new recalls from the official sources, matches them against every household
    // and raises alerts. Reads the NHTSA zip as a stream, so memory stays modest; a long timeout covers
    // slow source APIs. It also accepts a direct invocation with a seeded recall (demo mode).
    const watcherFunction = new NodejsFunction(this, 'WatcherFunction', {
      entry: watcherEntry,
      depsLockFilePath: lockFile,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(10),
      // A failed run is not retried by Lambda (the daily rule retries once, and the next day catches up);
      // stale queued events are dropped, so a failing backfill cannot keep hitting a struggling API.
      retryAttempts: 0,
      maxEventAge: cdk.Duration.hours(1),
      logGroup: new logs.LogGroup(this, 'WatcherLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: { TABLE_NAME: table.tableName },
      bundling: { minify: true, sourceMap: false },
    });
    table.grantReadWriteData(watcherFunction);

    // Every day at 07:00 UTC (a quiet hour in the US). One invocation, so the 10-concurrency account
    // quota (BLOCKERS B3) is never at risk.
    new events.Rule(this, 'DailyWatcherRule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new targets.LambdaFunction(watcherFunction, { retryAttempts: 1 })],
    });

    new cdk.CfnOutput(this, 'WatcherFunctionName', { value: watcherFunction.functionName });

    // The public simulator (the demo surface): UI + chat API on one Function URL. It keeps no state in
    // memory (conversations and spending caps live in DynamoDB), so any number of containers can serve it.
    const bedrockModel = 'anthropic.claude-haiku-4-5-20251001-v1:0';
    const simulatorFunction = new NodejsFunction(this, 'SimulatorFunction', {
      entry: simulatorEntry,
      depsLockFilePath: lockFile,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 50,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      logGroup: new logs.LogGroup(this, 'SimulatorLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: table.tableName,
        DEMO_KEY_PARAM,
        MCP_URL: `${url.url}mcp`,
        WATCHER_FUNCTION: watcherFunction.functionName,
        DAILY_TURNS: '600',
        DAILY_SPEECH_CHARS: '120000',
      },
      bundling: { minify: true, sourceMap: false },
    });
    table.grantReadWriteData(simulatorFunction);
    watcherFunction.grantInvoke(simulatorFunction);
    simulatorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: DEMO_KEY_PARAM.slice(1),
          }),
        ],
      }),
    );
    // One cheap Claude model, through the US cross-region inference profile.
    simulatorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/${bedrockModel}`,
          cdk.Stack.of(this).formatArn({
            service: 'bedrock',
            resource: 'inference-profile',
            resourceName: `us.${bedrockModel}`,
          }),
        ],
      }),
    );
    simulatorFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }),
    );
    const simulatorUrl = simulatorFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    new cdk.CfnOutput(this, 'SimulatorUrl', { value: simulatorUrl.url });

    new cdk.CfnOutput(this, 'McpUrl', { value: `${url.url}mcp` });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
