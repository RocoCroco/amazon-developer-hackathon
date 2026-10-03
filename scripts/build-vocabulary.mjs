// Builds the Amazon Transcribe custom vocabulary "recall-guardian-brands" from the brands in the deployed
// recall cache (T10.1): scan the cache, keep the brands people say, upload the table to the stack's private
// bucket, create or update the vocabulary, wait until READY, delete the file again.
// Usage: npm run build && node scripts/build-vocabulary.mjs [--print]   (--print: show the table, change nothing)
import { execFileSync } from 'node:child_process';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CreateVocabularyCommand,
  GetVocabularyCommand,
  TranscribeClient,
  UpdateVocabularyCommand,
} from '@aws-sdk/client-transcribe';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createDocClient } from '../packages/mcp-server/dist/dynamo-store.js';
import { buildVocabulary } from '../packages/mcp-server/dist/matcher/vocabulary.js';

const REGION = 'us-east-1';
const NAME = 'recall-guardian-brands';
const KEY = 'vocabulary/recall-guardian-brands.txt';
// The demo's brands and the baby-gear brands families name most often come first.
const MUST_INCLUDE = [
  'Aitjunz',
  'Chicco',
  'Graco',
  'Evenflo',
  'Britax',
  'Govee',
  'Nuna',
  'Maxi-Cosi',
  'UPPAbaby',
  'Cybex',
  'Diono',
  'Clek',
  'Doona',
  'Fisher-Price',
  'Kirkland',
  "Mercer's",
];

const output = (key) =>
  execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'RecallGuardianStack',
      '--region',
      REGION,
      '--query',
      `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`,
      '--output',
      'text',
    ],
    { encoding: 'utf8' },
  ).trim();

const table = output('TableName');
const bucket = output('VocabularyBucketName');

// 1. Brand counts from every cached recall (PK RCL#<id>, SK DATA).
const db = createDocClient(REGION);
const counts = new Map();
let startKey;
let recalls = 0;
do {
  const res = await db.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: 'begins_with(PK, :p) AND SK = :sk',
      ExpressionAttributeValues: { ':p': 'RCL#', ':sk': 'DATA' },
      ProjectionExpression: '#r.brands',
      ExpressionAttributeNames: { '#r': 'recall' },
      ExclusiveStartKey: startKey,
    }),
  );
  for (const item of res.Items ?? []) {
    recalls += 1;
    for (const brand of new Set(item.recall?.brands ?? [])) {
      counts.set(brand, (counts.get(brand) ?? 0) + 1);
    }
  }
  startKey = res.LastEvaluatedKey;
} while (startKey);

const { text, entries } = buildVocabulary(counts, MUST_INCLUDE);
console.log(
  `${recalls} cached recalls, ${counts.size} brands -> ${entries} vocabulary entries, ${Buffer.byteLength(text)} bytes`,
);

if (process.argv.includes('--print')) {
  process.stdout.write(text);
  process.exit(0);
}

// 2. Upload, create or update, wait, clean up.
const s3 = new S3Client({ region: REGION });
await s3.send(
  new PutObjectCommand({ Bucket: bucket, Key: KEY, Body: text, ContentType: 'text/plain' }),
);
const transcribe = new TranscribeClient({ region: REGION });
const uri = `s3://${bucket}/${KEY}`;
let exists = true;
try {
  await transcribe.send(new GetVocabularyCommand({ VocabularyName: NAME }));
} catch (error) {
  if (error.name !== 'NotFoundException' && error.name !== 'BadRequestException') throw error;
  exists = false;
}
if (exists) {
  await transcribe.send(
    new UpdateVocabularyCommand({
      VocabularyName: NAME,
      LanguageCode: 'en-US',
      VocabularyFileUri: uri,
    }),
  );
} else {
  await transcribe.send(
    new CreateVocabularyCommand({
      VocabularyName: NAME,
      LanguageCode: 'en-US',
      VocabularyFileUri: uri,
      Tags: [{ Key: 'Project', Value: 'recall-guardian' }],
    }),
  );
}
let state = 'PENDING';
let reason;
for (let i = 0; i < 120 && state === 'PENDING'; i++) {
  await new Promise((r) => setTimeout(r, 5_000));
  const v = await transcribe.send(new GetVocabularyCommand({ VocabularyName: NAME }));
  state = v.VocabularyState;
  reason = v.FailureReason;
}
await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: KEY }));
console.log(`vocabulary ${NAME}: ${state}${reason ? ` (${reason})` : ''}`);
if (state !== 'READY') process.exit(1);
