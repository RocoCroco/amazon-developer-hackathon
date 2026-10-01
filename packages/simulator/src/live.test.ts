import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Session } from './agent.js';
import { BedrockLlm } from './llm.js';
import { connectMcp } from './mcp-connection.js';

const aws = (...args: string[]) =>
  execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'text'], {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  }).trim();

/** Real Claude on Bedrock + the DEPLOYED MCP server. Run with: npm run test:live */
describe.skipIf(!process.env.LIVE)('live simulator conversation', () => {
  it('registers a heater and finds its recall through real MCP tool calls', async () => {
    const url = aws(
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'RecallGuardianStack',
      '--query',
      "Stacks[0].Outputs[?OutputKey=='McpUrl'].OutputValue",
    );
    const demoKey = aws(
      'ssm',
      'get-parameter',
      '--name',
      '/recall-guardian/demo-key',
      '--with-decryption',
      '--query',
      'Parameter.Value',
    );
    const mcp = await connectMcp({ url, demoKey }, randomBytes(16).toString('base64url'));
    const session = new Session(new BedrockLlm(), mcp);

    const first = await session.say(
      'We got a second-hand Govee space heater, model number H7131. Please register it.',
    );
    console.log('ASSISTANT 1:', first.reply);
    expect(first.toolCalls.map((t) => t.name)).toContain('add_item');

    const second = await session.say('Is it recalled?');
    console.log('ASSISTANT 2:', second.reply);
    const check = second.toolCalls.find((t) => t.name === 'check_item');
    expect(check?.result).toMatch(/"status":"recalled"/);
    expect(second.reply).toMatch(/recall|stop using|overheat/i);
    await session.close();
  }, 120_000);
});
