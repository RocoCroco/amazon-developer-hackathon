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
    // add_item checks recalls right away once brand and model are known.
    const added = first.toolCalls.find((t) => t.name === 'add_item');
    expect(added?.result).toMatch(/"status":"recalled"/);
    expect(first.reply).toMatch(/recall|stop using|overheat/i);

    const second = await session.say('What should I do?');
    console.log('ASSISTANT 2:', second.reply);
    expect(second.reply).toMatch(/stop using|refund|replace|contact|Govee/i);
    await session.close();
  }, 120_000);

  it('reads a noisy, accented transcript charitably', async () => {
    const mcp = await connectMcp(
      {
        url: aws(
          'cloudformation',
          'describe-stacks',
          '--stack-name',
          'RecallGuardianStack',
          '--query',
          "Stacks[0].Outputs[?OutputKey=='McpUrl'].OutputValue",
        ),
        demoKey: aws(
          'ssm',
          'get-parameter',
          '--name',
          '/recall-guardian/demo-key',
          '--with-decryption',
          '--query',
          'Parameter.Value',
        ),
      },
      randomBytes(16).toString('base64url'),
    );
    const session = new Session(new BedrockLlm(), mcp);
    // What the browser wrote for "We got a hand-me-down Chicco car seat" said with a Spanish accent.
    const turn = await session.say('we got a hand me down kiko car sit');
    console.log(
      'NOISY:',
      turn.reply,
      turn.toolCalls.map((t) => JSON.stringify(t.args)),
    );
    const add = turn.toolCalls.find((t) => t.name === 'add_item');
    expect(add?.args.name).toMatch(/car seat/i); // "car sit" understood
    expect(turn.reply).not.toMatch(/car sit/i);
    await session.close();
  }, 120_000);

  it('stays a normal but limited Alexa when asked something off topic', async () => {
    const mcp = await connectMcp(
      {
        url: aws(
          'cloudformation',
          'describe-stacks',
          '--stack-name',
          'RecallGuardianStack',
          '--query',
          "Stacks[0].Outputs[?OutputKey=='McpUrl'].OutputValue",
        ),
        demoKey: aws(
          'ssm',
          'get-parameter',
          '--name',
          '/recall-guardian/demo-key',
          '--with-decryption',
          '--query',
          'Parameter.Value',
        ),
      },
      randomBytes(16).toString('base64url'),
    );
    const session = new Session(new BedrockLlm(), mcp);
    for (const said of ["Alexa, what's the weather like tomorrow?", 'Play some jazz music.']) {
      const turn = await session.say(said);
      console.log('OFF TOPIC:', said, '->', turn.reply);
      expect(turn.toolCalls).toHaveLength(0);
      expect(turn.reply).toMatch(/simulation/i);
      expect(turn.reply).toMatch(/recall/i);
    }
    await session.close();
  }, 120_000);
});
