// Builds the architecture diagram from the official AWS Architecture Icons in docs/assets/aws-icons
// (copied unchanged from the AWS Architecture Icons package): docs/assets/architecture.svg and .png.
// Usage: node scripts/build-architecture.mjs
// The icons are embedded as-is (no recolouring, no distortion): only their position and size are set.
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const ICONS = 'docs/assets/aws-icons';
const W = 1800;
const H = 1000;
const FONT = "'Amazon Ember', 'Helvetica Neue', Arial, sans-serif";
const INK = '#232f3e';
const MUTED = '#545b64';

/** An official icon, nested at (x, y) with a square size; ids are removed so the icons can be combined. */
function icon(file, x, y, size) {
  const src = readFileSync(`${ICONS}/${file}`, 'utf8')
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/\sid="[^"]*"/g, '');
  return src.replace(
    /<svg\b[^>]*?(viewBox="[^"]*")[^>]*>/,
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" $1>`,
  );
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, { size = 17, weight = 400, color = INK, anchor = 'middle' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`;

/** A service: icon with a bold name and up to two muted lines under it, centred on cx. */
function service(file, cx, y, name, lines = [], size = 64) {
  return [
    icon(file, cx - size / 2, y, size),
    text(cx, y + size + 24, name, { weight: 700 }),
    ...lines.map((l, i) => text(cx, y + size + 46 + i * 20, l, { size: 15, color: MUTED })),
  ].join('\n');
}

/** A plain text box (for things that are not AWS services). */
function box(x, y, w, h, title, sub, { stroke = '#7d8998', dash = '' } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#ffffff" stroke="${stroke}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>
${text(x + w / 2, y + h / 2 - (sub ? 4 : -6), title, { weight: 700 })}
${sub ? text(x + w / 2, y + h / 2 + 18, sub, { size: 14, color: MUTED }) : ''}`;
}

/** An arrow with an optional label at its midpoint. */
function arrow(d, label, lx, ly, { color = INK, dash = '' } = {}) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#arrow)"/>
${
  label
    ? `<g>${label
        .split('\n')
        .map(
          (l, i) =>
            `<text x="${lx}" y="${ly + i * 17}" font-family="${FONT}" font-size="14" fill="${MUTED}" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="5">${esc(l)}</text>`,
        )
        .join('')}</g>`
    : ''
}`;
}

/** A dashed group frame with a title in its top-left corner. */
const group = (x, y, w, h, title, color) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="7 5"/>
${text(x + 14, y + 24, title, { size: 15, weight: 700, color, anchor: 'start' })}`;

// ---- layout -------------------------------------------------------------------------------------------
const cloud = { x: 290, y: 60, w: 1190, h: 880 };
const parts = [];

// AWS Cloud group (official group icon top-left)
parts.push(
  `<rect x="${cloud.x}" y="${cloud.y}" width="${cloud.w}" height="${cloud.h}" fill="none" stroke="${INK}" stroke-width="2"/>`,
);
parts.push(icon('AWS-Cloud-logo_32.svg', cloud.x, cloud.y, 40));
parts.push(
  text(cloud.x + 50, cloud.y + 26, 'AWS Cloud · us-east-1 · one CDK stack, serverless only', {
    weight: 700,
    anchor: 'start',
  }),
);

// Left, outside the cloud: the family and the browser page
parts.push(box(40, 330, 200, 76, 'Family', 'voice or text'));
parts.push(box(40, 480, 200, 96, 'Simulator page', 'browser, wake word, mic'));
parts.push(arrow('M140 406 L140 474', '', 0, 0));

// Group: Alexa+ (simulated)
parts.push(group(330, 110, 470, 590, 'Alexa+ (simulated)', '#7b42bc'));
parts.push(
  service('Arch_Amazon-Bedrock_64.svg', 440, 170, 'Amazon Bedrock', [
    'Claude Haiku 4.5',
    'Converse API, tool use',
  ]),
);
parts.push(service('Arch_Amazon-Polly_64.svg', 690, 170, 'Amazon Polly', ['neural voice, SSML']));
parts.push(
  service('Arch_AWS-Lambda_64.svg', 565, 360, 'Simulator', [
    'Lambda + Function URL',
    'agent loop, voice, demo',
  ]),
);
parts.push(
  service('Arch_Amazon-Transcribe_64.svg', 450, 540, 'Amazon Transcribe', [
    'streaming, en-US,',
    'brand vocabulary',
  ]),
);
parts.push(
  service('Arch_Amazon-Simple-Storage-Service_64.svg', 690, 540, 'Amazon S3', ['vocabulary file']),
);

// Group: Recall Guardian MCP server
parts.push(group(860, 110, 590, 590, 'Recall Guardian MCP server', '#1a66ff'));
parts.push(
  service('Arch_AWS-Lambda_64.svg', 1060, 360, 'MCP server', [
    'Lambda + Function URL',
    'spec 2025-11-25, 11 tools',
  ]),
);
parts.push(
  service('Arch_Amazon-DynamoDB_64.svg', 1060, 540, 'Amazon DynamoDB', [
    'inventory, alerts,',
    'recall cache, caps',
  ]),
);
parts.push(
  service('Arch_AWS-Systems-Manager_64.svg', 1340, 170, 'Systems Manager', [
    'Parameter Store',
    'demo key',
  ]),
);
parts.push(
  service('Arch_Amazon-CloudWatch_64.svg', 1340, 540, 'Amazon CloudWatch', ['logs, 1 week']),
);

// Group: daily watcher
parts.push(group(860, 730, 590, 180, 'Daily watcher', '#e7157b'));
parts.push(
  service('Arch_Amazon-EventBridge_64.svg', 960, 760, 'Amazon EventBridge', ['daily, 07:00 UTC']),
);
parts.push(
  service('Arch_AWS-Lambda_64.svg', 1220, 760, 'Watcher', [
    'Lambda: new recalls',
    'matched to every home',
  ]),
);

// Bottom-left: how it is built and secured
parts.push(group(330, 730, 470, 180, 'Built and secured', '#545b64'));
parts.push(
  service(
    'Arch_AWS-Cloud-Development-Kit_64.svg',
    420,
    760,
    'AWS CDK',
    ['infrastructure as code'],
    56,
  ),
);
parts.push(
  service('Arch_AWS-CloudFormation_64.svg', 565, 760, 'CloudFormation', ['one stack'], 56),
);
parts.push(
  service(
    'Arch_AWS-Identity-and-Access-Management_64.svg',
    710,
    760,
    'IAM',
    ['least privilege'],
    56,
  ),
);

// Right, outside the cloud: official recall data (text only)
parts.push(text(1640, 236, 'Official recall data', { weight: 700 }));
parts.push(box(1540, 260, 200, 70, 'CPSC', 'consumer products'));
parts.push(box(1540, 350, 200, 70, 'NHTSA', 'vehicles, car seats, tires'));
parts.push(box(1540, 440, 200, 70, 'openFDA', 'food, drugs, allergens'));

// ---- flows ----------------------------------------------------------------------------------------------
parts.push(arrow('M240 520 L525 400', 'HTTPS /api', 375, 446));
parts.push(arrow('M240 560 L410 568', 'audio stream', 318, 552));
parts.push(arrow('M548 358 L462 306', 'Converse', 476, 348));
parts.push(arrow('M582 358 L668 284', 'SSML', 652, 340));
parts.push(
  arrow('M600 392 L1018 392', 'MCP · Streamable HTTP\nBearer key + household id', 810, 374, {
    color: '#1a66ff',
  }),
);
parts.push(
  arrow(
    'M1060 356 L1060 99 L312 99 L312 202 L400 202',
    'second opinion (downgrade only)',
    1180,
    94,
    { color: '#7b42bc', dash: '6 4' },
  ),
);
parts.push(arrow('M1094 372 L1300 214', 'reads key', 1215, 270));
parts.push(arrow('M1060 494 L1060 532', '', 0, 0));
parts.push(arrow('M1100 400 L1532 300', '', 0, 0));
parts.push(arrow('M1100 410 L1532 385', '', 0, 0));
parts.push(arrow('M1100 420 L1532 470', 'live lookups, 6 s timeout', 1380, 478));
parts.push(arrow('M1000 792 L1180 792', '', 0, 0));
parts.push(arrow('M1220 756 L1220 572 L1102 572', 'new alerts', 1262, 690));
parts.push(arrow('M1254 792 L1510 792 L1510 490 L1532 490', 'daily feeds', 1440, 782));

// legend line
parts.push(
  text(
    W / 2,
    H - 22,
    'Recall Guardian architecture. Icons: AWS Architecture Icons. Regenerate: node scripts/build-architecture.mjs',
    { size: 14, color: MUTED },
  ),
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${INK}"/></marker></defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${parts.join('\n')}
</svg>
`;
writeFileSync('docs/assets/architecture.svg', svg);
await sharp(Buffer.from(svg), { density: 144 }).png().toFile('docs/assets/architecture.png');
console.log('wrote docs/assets/architecture.svg and docs/assets/architecture.png');
