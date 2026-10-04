// Rehearses the demo recording script (docs/video-script.md, part 2) against the DEPLOYED simulator in text mode:
// the same API calls the page makes, with real Claude on Bedrock and the real watcher. Costs a few cents per run.
// Usage: node scripts/rehearse-demo.mjs [runs] [url]
// The brand and model lines are sent the way Amazon Transcribe usually writes them ("8th June", spaced letters).
import { execFileSync } from 'node:child_process';

const runs = Number(process.argv[2] ?? 1);
const url =
  process.argv[3] ||
  execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'RecallGuardianStack',
      '--query',
      "Stacks[0].Outputs[?OutputKey=='SimulatorUrl'].OutputValue",
      '--region',
      'us-east-1',
      '--output',
      'text',
    ],
    { encoding: 'utf8' },
  ).trim();

const post = async (path, body) => {
  const res = await fetch(new URL(path, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
};
const state = async (sessionId) =>
  (await fetch(new URL(`api/state?sessionId=${encodeURIComponent(sessionId)}`, url))).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The steps of part 2. `expect` checks Alexa's reply; `after` checks the household panel.
const STEPS = [
  {
    say: 'Alexa, we were gifted a dresser and a Chicco KeyFit 30 car seat from 2023.',
    expect: [
      [/chicco/i, 'mentions the Chicco car seat'],
      [/brand|who makes|make of|made by/i, 'asks who makes the dresser'],
    ],
  },
  {
    say: "It's an 8th June.",
    expect: [[/A-I-T-J-U-N-Z/i, 'asks "Aitjunz, A-I-T-J-U-N-Z?"']],
  },
  {
    say: 'Yes. The model is L D Q M F J 8 D B K.',
    expect: [
      [/recall/i, 'says the dresser is recalled'],
      [/tip|trap|stop using/i, 'gives the hazard or the first action'],
    ],
    after: [
      (s) => s.alerts.some((a) => a.kind === 'recalled' && /aitjunz/i.test(a.item)),
      'dresser is red in the panel',
    ],
  },
  {
    say: "Alexa, Leo is allergic to peanuts. And we have Mercer's ice cream sandwiches in the freezer.",
    expect: [
      [/peanut/i, 'mentions peanuts'],
      [/mercer/i, "mentions Mercer's"],
      [/lot|recall|code/i, 'flags the food recall or asks for the lot code'],
    ],
    after: [(s) => s.alerts.some((a) => /mercer/i.test(a.item)), "Mercer's flagged in the panel"],
  },
  { simulateRecall: true },
  {
    say: 'Yes, walk me through it.',
    expect: [
      [/chicco|car seat/i, 'talks about the car seat'],
      [/stop using|don't use|do not use/i, 'says stop using it first'],
      [/call|contact|kit|replace|free/i, 'says how to get the fix'],
    ],
  },
  {
    say: "I got the kit, it's fixed.",
    expect: [
      [
        /closed|resolved|all set|marked|done|great|perfect|fixed/i,
        'confirms the car seat is sorted',
      ],
    ],
    after: [
      (s) => !s.alerts.some((a) => /chicco/i.test(a.item) && a.kind === 'recalled'),
      'car seat alert closed (dot green)',
    ],
  },
];

let failures = 0;
for (let run = 1; run <= runs; run++) {
  console.log(`\n===== run ${run} of ${runs} =====`);
  let sessionId;
  let announced; // what the page spoke on its own; sent with the next message, as the page does
  const runStart = Date.now();
  for (const step of STEPS) {
    if (step.simulateRecall) {
      const r = await post('api/demo/new-recall', { sessionId });
      console.log(`[Settings > Simulate new recall] ${r.message}`);
      let alert;
      for (let i = 0; i < 30 && !alert; i++) {
        await sleep(2000);
        alert = (await state(sessionId)).alerts.find(
          (a) => a.kind === 'recalled' && /chicco/i.test(a.item),
        );
      }
      const ok = Boolean(alert);
      if (!ok) failures++;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} the watcher raised a car seat recall (the page speaks "Heads up: ...")`,
      );
      if (alert) {
        // The same words the page builds in refreshState (public/app.js).
        const text = String(alert.allergy_note ?? (alert.hazard || alert.title) ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        const end = text.search(/[.!?](\s|$)/);
        const first = end === -1 ? text : text.slice(0, end + 1);
        announced = `Heads up: your ${alert.item} has a recall. ${first} Want me to walk you through the fix?`;
        console.log(`     page says: ${announced}`);
      }
      continue;
    }
    const t = Date.now();
    const r = await post(
      'api/chat',
      announced ? { sessionId, message: step.say, announced } : { sessionId, message: step.say },
    );
    announced = undefined;
    sessionId = r.sessionId;
    const tools = (r.toolCalls ?? []).map((c) => c.name).join(', ');
    console.log(`\nYOU:   ${step.say}`);
    console.log(`ALEXA: ${r.reply}  [${((Date.now() - t) / 1000).toFixed(1)}s; ${tools}]`);
    for (const [re, label] of step.expect) {
      const ok = re.test(r.reply ?? '');
      if (!ok) failures++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    }
    if (step.after) {
      await sleep(500);
      const ok = step.after[0](await state(sessionId));
      if (!ok) failures++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${step.after[1]}`);
    }
  }
  await post('api/reset', { sessionId });
  console.log(`\n(reset; run took ${((Date.now() - runStart) / 1000).toFixed(0)}s)`);
}
console.log(failures === 0 ? '\nREHEARSAL OK' : `\n${failures} FAILED CHECKS`);
process.exit(failures === 0 ? 0 : 1);
