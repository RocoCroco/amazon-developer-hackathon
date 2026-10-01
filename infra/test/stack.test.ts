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

describe('daily watcher', () => {
  const template = synth();

  it('is a second Lambda with a long timeout, more memory, and only the table name', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 600,
      MemorySize: 1024,
      Environment: { Variables: { TABLE_NAME: Match.anyValue() } },
    });
    const functions = Object.values(
      template.toJSON().Resources as Record<
        string,
        { Type: string; Properties: { Timeout?: number } }
      >,
    ).filter((r) => r.Type === 'AWS::Lambda::Function' && r.Properties.Timeout !== undefined);
    expect(functions).toHaveLength(3); // the MCP function, the watcher and the simulator
  });

  it('runs once a day through EventBridge', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 7 * * ? *)',
      State: 'ENABLED',
    });
    template.resourceCountIs('AWS::Events::Rule', 1);
  });

  it('is not reachable from the internet (no Function URL on the watcher)', () => {
    template.resourceCountIs('AWS::Lambda::Url', 2); // the MCP function and the simulator, never the watcher
  });

  it('lets only the MCP function and the simulator read the demo key parameter', () => {
    const json = JSON.stringify(template.toJSON());
    // The SSM read permission appears in exactly two policies.
    expect(json.split('ssm:GetParameter').length - 1).toBe(2);
  });
});

describe('public simulator', () => {
  const template = synth();
  const json = JSON.stringify(template.toJSON());

  it('is a Lambda behind a Function URL that knows where everything is', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          MCP_URL: Match.anyValue(),
          WATCHER_FUNCTION: Match.anyValue(),
          DAILY_TURNS: '600',
          DAILY_SPEECH_CHARS: '120000',
        }),
      },
    });
  });

  it('may call Polly, one Claude model and the watcher, and nothing wider', () => {
    expect(json).toContain('polly:SynthesizeSpeech');
    expect(json).toContain('bedrock:InvokeModel');
    expect(json).toContain('anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(json).toContain('lambda:InvokeFunction');
    // No "everything" action in any policy statement (resource ARNs may use wildcards, actions may not).
    const actions = Object.values(
      template.toJSON().Resources as Record<
        string,
        {
          Type: string;
          Properties: { PolicyDocument?: { Statement: { Action: string | string[] }[] } };
        }
      >,
    )
      .filter((r) => r.Type === 'AWS::IAM::Policy')
      .flatMap((r) => r.Properties.PolicyDocument!.Statement.flatMap((s) => [s.Action].flat()));
    expect(actions.length).toBeGreaterThan(5);
    expect(actions.filter((a) => a === '*' || /^[a-z0-9-]+:\*$/.test(a))).toEqual([]);
  });

  it('has the daily spending caps wired in', () => {
    expect(json).toContain('DAILY_TURNS');
    expect(json).toContain('DAILY_SPEECH_CHARS');
  });
});

describe('reserved concurrency (account quota raised to 1000)', () => {
  const template = synth();
  it('caps every function: 50 for the public ones, 1 for the watcher', () => {
    const values = Object.values(
      template.toJSON().Resources as Record<
        string,
        { Type: string; Properties: { ReservedConcurrentExecutions?: number; Timeout?: number } }
      >,
    )
      .filter((r) => r.Type === 'AWS::Lambda::Function' && r.Properties.Timeout !== undefined)
      .map((r) => r.Properties.ReservedConcurrentExecutions)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(values).toEqual([1, 50, 50]);
  });
});
