// Verifies the DEPLOYED public simulator in a real browser (T5.3): real Claude on Bedrock, real Polly, the
// real watcher Lambda. Costs a few cents. Usage: node scripts/verify-simulator.mjs [url] [screenshot.png]
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const aws = (...args) =>
  execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'text'], {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  }).trim();

const url =
  process.argv[2] ||
  aws(
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'RecallGuardianStack',
    '--query',
    "Stacks[0].Outputs[?OutputKey=='SimulatorUrl'].OutputValue",
  );
const shot = process.argv[3];
console.log('simulator:', url);

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
};
const until = async (fn, label, ms = 60000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  check(false, `${label} (timed out after ${ms / 1000}s)`);
  return false;
};

const config = await fetch(new URL('api/config', url)).then((r) => r.json());
check(config.speech === true && config.demo === true, `config: ${JSON.stringify(config)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await page.goto(url);

// 1. Sample family in one click.
await page.click('#menu-button');
await page.click('#demo-seed');
check(
  await until(
    async () => (await page.locator('#inventory .item').count()) === 2,
    'sample family loaded',
  ),
  'sample family loaded (2 items)',
);

// 2. Ask the real model.
const before = await page.locator('#transcript .bubble.alexa').count();
const started = Date.now();
const speakPromise = page.waitForResponse((r) => r.url().includes('/api/speak'), {
  timeout: 90000,
});
const chatPromise = page.waitForResponse((r) => r.url().includes('/api/chat'), { timeout: 90000 });
await page.fill('#message', 'Is anything we own recalled?');
await page.click('#send');
await until(
  async () => (await page.locator('#transcript .bubble.alexa').count()) > before,
  'Claude answers',
  90000,
);
const reply = await page.locator('#transcript .bubble.alexa').last().textContent();
console.log(
  `     reply (${((Date.now() - started) / 1000).toFixed(1)}s): ${reply?.replace(/MCP.*$/s, '').trim()}`,
);
check(
  /Govee/i.test(reply ?? '') && /recall/i.test(reply ?? ''),
  'the real model reports the Govee heater recall',
);
check(
  (await page.locator('#transcript .bubble.alexa').last().locator('.chip').count()) > 0,
  'the answer shows the MCP tool calls it made',
);
check(
  await until(
    async () => (await page.locator('#inventory .item[data-status=recalled]').count()) >= 1,
    'alerts panel',
    15000,
  ),
  'the alerts panel shows the recall',
);

// 3. The Polly voice: the page asked the server to speak the reply; the answer must be audio.
const speakResponse = await speakPromise.catch(() => null);
check(speakResponse?.status() === 200, `/api/speak answered ${speakResponse?.status()}`);
// The page already consumed that response, so fetch audio again with the page's own session.
const sessionId = (await (await chatPromise).json()).sessionId;
const direct = await fetch(new URL('api/speak', url), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId, text: 'Your Govee H7131 space heater is recalled.' }),
});
const audioBytes = (await direct.arrayBuffer()).byteLength;
check(
  (direct.headers.get('content-type') ?? '').startsWith('audio/') && audioBytes > 1000,
  `Polly audio received (${audioBytes} bytes)`,
);

// 4. Time skip: publish a new recall; the real watcher Lambda matches it; the family is warned unprompted.
const proactiveBefore = await page.locator('#transcript .bubble.proactive').count();
await page.click('#menu-button');
await page.click('#demo-recall');
const warned = await until(
  async () => (await page.locator('#transcript .bubble.proactive').count()) > proactiveBefore,
  'proactive alert after the simulated recall',
  90000,
);
if (warned) {
  console.log(
    '     proactive:',
    (await page.locator('#transcript .bubble.proactive').last().textContent())?.trim(),
  );
  check(
    /Chicco/i.test(
      (await page.locator('#transcript .bubble.proactive').last().textContent()) ?? '',
    ),
    'the warning is about the Chicco car seat',
  );
}
if (shot) await page.screenshot({ path: shot });

// 5. Clean up.
await page.click('#menu-button');
await page.click('#reset');
check(
  await until(
    async () => (await page.locator('#inventory .item').count()) === 0,
    'reset',
    30000,
  ),
  'reset empties the household',
);
await browser.close();
console.log(failed ? 'SIMULATOR VERIFICATION FAILED' : 'SIMULATOR VERIFIED');
process.exitCode = failed ? 1 : 0;
