import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { RecallGuardianStack } from '../lib/recall-guardian-stack.js';

const FORBIDDEN = [
  'AWS::EC2::Instance',
  'AWS::EC2::NatGateway',
  'AWS::RDS::DBInstance',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::OpenSearchService::Domain',
  'AWS::Elasticsearch::Domain',
];

function synth(): Template {
  const app = new cdk.App();
  const stack = new RecallGuardianStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  cdk.Tags.of(app).add('Project', 'recall-guardian');
  return Template.fromStack(stack);
}

describe('RecallGuardianStack', () => {
  const template = synth();

  it('uses an on-demand DynamoDB table with a TTL attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('runs the MCP Lambda with a timeout, modest memory and a public Function URL', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 30,
      MemorySize: 512,
      Environment: {
        Variables: Match.objectLike({ DEMO_KEY_PARAM: '/recall-guardian/demo-key' }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('never puts the demo key value in the template', () => {
    expect(JSON.stringify(template.toJSON())).not.toMatch(/"DEMO_KEY"/);
  });

  it('tags resources with Project=recall-guardian', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([{ Key: 'Project', Value: 'recall-guardian' }]),
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([{ Key: 'Project', Value: 'recall-guardian' }]),
    });
  });

  it('contains no resource with an hourly cost', () => {
    const types = Object.values(
      template.toJSON().Resources as Record<string, { Type: string }>,
    ).map((r) => r.Type);
    for (const forbidden of FORBIDDEN) expect(types).not.toContain(forbidden);
  });
});
