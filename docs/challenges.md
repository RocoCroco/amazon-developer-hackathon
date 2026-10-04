# How Recall Guardian answers each challenge

Exact rule wording: docs/rules.md. Architecture: docs/architecture.md.

## Alexa+ track (primary)

> "Build a working Agent Skill or a self-hosted MCP server, implementing MCP spec version (minimum acceptable
> version is 2025-11-25)"

| Requirement | How we meet it | Evidence |
|---|---|---|
| Self-hosted MCP server | Our own server on AWS Lambda behind a public HTTPS Function URL (`McpUrl` stack output) | `packages/mcp-server/src/handler.ts`, `lambda.ts`; `infra/lib/recall-guardian-stack.ts` |
| Spec 2025-11-25 or later | Official TypeScript SDK; the protocol version is negotiated and asserted in a test | `server.test.ts` ("negotiates the latest protocol version") |
| Streamable HTTP | Stateless Streamable HTTP with JSON responses | `handler.ts` (`WebStandardStreamableHTTPServerTransport`) |
| Used at runtime, not just mentioned | Every assistant answer comes from MCP tool calls; the page shows a chip per call ("MCP · add_item") | browser tests; `npm run e2e:deployed` against the live stack |
| Working | Deployed and verified end to end: three data sources, the daily watcher, the public simulator with real Claude and Polly | `scripts/smoke-deployed.mjs`, `verify-watcher.mjs`, `verify-simulator.mjs` |

**Why it belongs on Alexa+:** recall safety needs three things a voice assistant in the home is uniquely good at:
knowing what the family owns without forms ("we got a hand-me-down car seat"), checking it right away, and
speaking up later, unprompted, when a new recall appears. The CPSC's own workshop report names home voice
assistants as a way to reach owners (docs/sources.md). Everything the assistant needs is in the tool answers:
short spoken sentences, the one question to ask when unsure, and what to do next, so any MCP-capable assistant can
use it unchanged.

**What is simulated, said plainly:** the Alexa+ assistant itself. Our web simulator uses Claude on Bedrock as the
brain, Amazon Transcribe as the ears and Amazon Polly as the voice, and calls the MCP server exactly as an
assistant would. The rules allow a simulated Alexa+ experience.

## AWS Builder mini challenge

> "Any primary track project that incorporates AWS services (i.e. Amazon Bedrock, AgentCore, Strands SDK, Kiro
> Crew, SageMaker, etc.) with documented integrations"

| AWS service | What it does in Recall Guardian | Where |
|---|---|---|
| **Amazon Bedrock** (Claude Haiku 4.5, Converse API with tool use) | (1) The assistant's brain in the simulator, calling our MCP tools; (2) inside the MCP server, a downgrade-only second opinion on every recall match | `packages/simulator/src/llm.ts`, `agent.ts`; `packages/mcp-server/src/matcher/confirm.ts` |
| **Amazon Transcribe** (streaming over WebSocket, custom vocabulary) | The microphone: US English speech to text, with a vocabulary of ~2,000 brand names from our recall data; the page streams directly to Transcribe with a URL our Lambda presigns | `packages/simulator/src/transcribe.ts`, `public/voice.js`, `public/eventstream.js`, `scripts/build-vocabulary.mjs` |
| **Amazon Polly** (neural and generative voices, SSML) | Alexa's voice; model codes and spelled brands read letter by letter; the page reveals words in step with the audio | `packages/simulator/src/speech.ts` |
| **AWS Lambda** (3 functions, Node.js 22, arm64, Function URLs, reserved concurrency) | MCP server, daily watcher, simulator back end | `infra/lib/recall-guardian-stack.ts` |
| **Amazon DynamoDB** (on-demand, single table, TTL) | Inventories, alerts, allergies, a copy of every CPSC recall since mid-2011 with brand and product indexes, conversations, atomic daily spending caps | `dynamo-store.ts`, `dynamo-alerts.ts`, `recalls/dynamo-recall-store.ts`, `session-store.ts` |
| **Amazon EventBridge** (scheduled rule) | Runs the watcher every day at 07:00 UTC | stack |
| **AWS Systems Manager Parameter Store** (SecureString) | The shared demo key, read at cold start; never in code or templates | `lambda.ts` in both packages |
| **Amazon S3** | Holds the Transcribe vocabulary file while Transcribe reads it | stack, `scripts/build-vocabulary.mjs` |
| **Amazon CloudWatch Logs** | Function logs, one-week retention | stack |
| **AWS IAM** | Least-privilege role per function | stack; `infra/test/stack.test.ts` |
| **AWS CDK** | The whole stack as code; tests forbid any resource with an hourly price | `infra/` |

Cost: about $12 a month at demo usage, with daily caps (docs/costs.md). AWS feedback per service: FEEDBACK.md.
Problems met and solved: FRICTION_LOG.md (CPSC refusing AWS traffic, Transcribe's garbled doc example, ...).

## Open Source mini challenge

> "Create a new, additional open-source project or contribute to an existing public repository during the
> hackathon window, alongside a primary track submission"

**Our entry: the Open Recall Format**, a new, separate open-source project created during the hackathon window:
an open, owner-side data format for product recalls, with converters for seven official recall sources, a reference
checker, a CLI and 75 tests on real government records.

- Repository: https://github.com/RocoCroco/open-recall-format (Apache-2.0 code, CC BY 4.0 specification; release
  v0.1.0; tests run in GitHub Actions)
- Contribution to an existing public repository: a concrete schema.org `ProductRecall` proposal on
  https://github.com/schemaorg/schemaorg/issues/3229#issuecomment-5979280862
- Research and first design: docs/open-recall-format.md; Devpost fields and text: docs/devpost-submission.md

Why a separate project: the rule asks for a *new, additional* open-source project (or a contribution to someone
else's repository). Making this Recall Guardian repository public would not count on its own; the Open Recall Format
is that additional project, and Recall Guardian is its first use case.

## Judging criteria: what to show for each

| Criterion | Our strongest evidence |
|---|---|
| Tech Implementation | Real MCP server on Lambda (11 tools, spec 2025-11-25, stateless Streamable HTTP); matcher on 1,313 real recalls with a blind challenge set and 0 false "recalled" claims; outage-proof data path; 440+ automated tests including real-browser and deployed checks |
| Design | Hands-free conversation like an Echo (wake word, follow-up, "thanks" ends it); Alexa asks only what matters (the model number only when some models are recalled); the household panel turns red with the product photo; voice-first answers |
| Potential Impact | Verified need: about 6% of consumers act on a press-release recall, about 50% with direct notice (CPSC, docs/sources.md); covers what retailer emails cannot: gifts, second-hand items, cars, food and medicine, family allergies. All numbers, with sources and safe phrasings: docs/impact.md |
| Quality of the Idea | Turns the assistant into a guardian that speaks up unprompted; solves misheard brands in the server by sound; never says "no recalls" when it could not check |
