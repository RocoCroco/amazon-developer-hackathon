import * as cdk from 'aws-cdk-lib';
import { RecallGuardianStack } from '../lib/recall-guardian-stack.js';

const app = new cdk.App();
new RecallGuardianStack(app, 'RecallGuardianStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
cdk.Tags.of(app).add('Project', 'recall-guardian');
