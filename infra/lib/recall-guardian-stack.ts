import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

    new cdk.CfnOutput(this, 'McpUrl', { value: `${url.url}mcp` });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
