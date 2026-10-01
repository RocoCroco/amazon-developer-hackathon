import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoControls, lambdaWatcherInvoker } from './demo.js';
import { BedrockLlm } from './llm.js';
import { RuleBasedLlm } from './mock-brain.js';
import { startSimulator } from './server.js';
import { PollySpeaker } from './speech.js';

const mcpUrl = process.env.MCP_URL ?? 'http://127.0.0.1:8788/mcp';
const useMock = process.env.SIM_LLM === 'mock';
const here = path.dirname(fileURLToPath(import.meta.url));

const sim = await startSimulator(
  {
    mcp: { url: mcpUrl, demoKey: process.env.DEMO_KEY },
    llm: () => (useMock ? new RuleBasedLlm() : new BedrockLlm()),
    staticDir: path.resolve(here, '../public'),
    // Amazon Polly voice; set SPEECH=off to use only the browser's built-in voice.
    speaker: process.env.SPEECH === 'off' ? undefined : new PollySpeaker(),
    // Demo buttons need the deployed watcher: WATCHER_FUNCTION is the function name (stack output).
    demo: process.env.WATCHER_FUNCTION
      ? createDemoControls(lambdaWatcherInvoker(process.env.WATCHER_FUNCTION))
      : undefined,
  },
  Number(process.env.PORT ?? 8787),
);
console.log(
  `Simulator: ${sim.url}  (MCP: ${mcpUrl}, brain: ${useMock ? 'rule-based mock' : 'Bedrock'}, voice: ${process.env.SPEECH === 'off' ? 'browser' : 'Polly'})`,
);
