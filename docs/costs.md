# Cost estimate (T4.5)

**Bottom line: about $8 per month at the demo usage defined below; the Bedrock language model is the only
cost that is not effectively zero.** Everything else (Lambda, DynamoDB, EventBridge, SSM, CloudWatch, S3,
CloudFront) stays inside free tiers or costs cents. The hard budget is the $130 credit budget the human
created in AWS Budgets ("creditos hackathon").

Region: us-east-1. Serverless only: no EC2, NAT gateway, RDS, load balancer, OpenSearch or anything with an
hourly price (a CDK test, `infra/test/stack.test.ts`, fails if one appears).

## Real measurements (CloudWatch, 2026-10-01)

| Function | Memory | Billed duration | Peak memory |
|---|---|---|---|
| Watcher, first real run (syncs 4 sources, 109 recalls, scans households) | 1,024 MB | 9.3 s | 159 MB |
| MCP server, one tool call | 512 MB | 19 ms | 140 MB |

DynamoDB is on-demand, one table; at demo scale it holds a few hundred recalls plus a handful of households
(well under 5 MB).

## Demo usage assumed

One month that includes the judging period, with real traffic from judges and a few dozen test sessions:

- **150 simulator conversations**, 8 user turns each (voice or typed), about 1.5 model calls per turn (some
  turns call a tool and the model answers afterwards): **1,800 model calls**.
- About 2,500 input tokens per call (system prompt about 400 + nine tool definitions about 1,240 (both measured as characters / 4) + history)
  and 100 output tokens.
- 1,200 spoken replies of about 140 characters.
- About 4,300 MCP requests (15 per conversation plus 2,000 for development and checks).
- The daily watcher runs 30 times.

## Per service

| Service | Unit price (list) | Usage | Monthly cost |
|---|---|---|---|
| **Bedrock, Claude Haiku 4.5** (input) | $1.00 / 1M tokens | 1,800 x 2,500 = 4.5M tokens | **$4.50** |
| Bedrock, Claude Haiku 4.5 (output) | $5.00 / 1M tokens | 1,800 x 100 = 0.18M tokens | **$0.90** |
| **Amazon Polly**, neural voice | $16 / 1M characters | 1,200 x 140 = 168,000 characters | **$2.69** (free for 1M chars/month in the first 12 months of a new account) |
| Lambda requests | $0.20 / 1M | about 7,000 incl. watcher and simulator | $0.00 |
| Lambda compute (arm64) | free tier 400,000 GB-s/month | watcher 30 x 9.3 s x 1 GB = 279 GB-s; MCP 4,300 x 0.15 s x 0.5 GB = 323 GB-s; simulator backend about 1,800 GB-s | $0.00 (about 2,400 GB-s of 400,000) |
| DynamoDB on-demand | $1.25 / 1M writes, $0.25 / 1M reads (conservative; recent rate cuts make it lower) | about 25,000 request units, under 5 MB stored (free tier 25 GB) | $0.03 |
| CloudWatch Logs | $0.50 / GB ingested; 1-week retention | about 5 MB | $0.01 |
| EventBridge scheduled rule | free | 30 invocations | $0.00 |
| SSM Parameter Store (standard SecureString, AWS-managed key) | free | 1 parameter | $0.00 |
| S3 + CloudFront for the simulator UI | CloudFront always-free 1 TB and 10M requests | 5 MB site, about 2 GB transfer | about $0.00 |
| **Total** | | | **about $8.1** |

Calculation: Bedrock 4.50 + 0.90 = 5.40; Polly 2.69; the rest about 0.05 -> **$8.14**, under the $10 target.
If the Polly free tier applies, about $5.5.

## What would blow the estimate, and the guards

| Risk | Effect | Guard |
|---|---|---|
| A bigger model for the demo brain (Sonnet 4.6 is about 3x Haiku's price) | Bedrock about $16 | default and tests use Haiku 4.5; `BEDROCK_MODEL_ID` is the only switch |
| 500 conversations instead of 150 | Bedrock about $18 | per-session turn limit (40) and tool-round limit (6) in the simulator; add a daily global cap before going public (T5.3) |
| Anyone calling the public MCP URL | Lambda is nearly free; no model cost on this path | demo key (401 otherwise), unguessable household ids, 30 s timeout, account concurrency quota of 10 (BLOCKERS B3) |
| Bedrock prompt caching not used | the system prompt and tool definitions (about 1,650 of the 2,500 input tokens) are paid on every call | lever, not needed for the estimate: caching them would cut the Bedrock input cost by about half |
| Long Polly replies | 16 dollars per million characters | replies are capped to a few short sentences by the voice-first rules; fixed demo phrases can be cached |

Safety net: the account-level AWS Budget (created by the human) alerts on spend; no resource in the stack has an
hourly cost, so doing nothing costs close to nothing. `cd infra && npx cdk destroy` removes everything the
project created (the table and log groups are set to be destroyed with the stack); the CDK bootstrap stack
(`CDKToolkit`) and the manually created SSM parameter `/recall-guardian/demo-key` remain and cost nothing.

## Prices and where they come from

List prices checked on 2026-10-01 against public sources; confirm on the AWS pricing pages before relying on
them for a different usage level:
Bedrock Claude Haiku 4.5 ($1 / $5 per million input / output tokens), Amazon Polly neural voices
($16 per million characters; https://aws.amazon.com/polly/pricing/), AWS Lambda free tier (400,000 GB-seconds and
1M requests per month), DynamoDB on-demand request units. Token counts per call are estimates from the actual
prompt and tool definitions; the Lambda figures are measured.
