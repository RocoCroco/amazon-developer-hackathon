# Recall Guardian — Product Spec (working name)

Hackathon: Amazon "Build, Ship, Shape" — Alexa+ track (https://amazonappdev2026.devpost.com/)
Deadline: **October 23, 2026, 12:00 PT**. Everything must be submitted before that.

## 1. The problem

When a dangerous product is recalled (a child car seat, a space heater, a dresser that tips over, a contaminated food), most people who own it never find out.

- CPSC workshop (2017): average consumer participation in recalls is ~6%. When the recall was announced only by press release, correction was ~6%; when owners were notified directly (mail, phone, email), it rose to ~50%.
- The bottleneck is that nobody knows who owns what: almost nobody fills in product registration cards.
- Amazon already notifies customers about recalls of products bought on Amazon. Nothing covers everything else in the home: gifts, second-hand items, hand-me-down baby gear, in-store purchases, cars, food and medicine.

## 2. The solution

An MCP server that turns Alexa+ into a recall guardian for everything in the home:

1. **Register by voice** — the step people never do. "Alexa, we got a Graco car seat from my cousin." Alexa asks only what's needed (brand, model, roughly when it was made/bought) and saves it to the household inventory.
2. **Check instantly** — "Is this stroller recalled?" / "Check everything we own."
3. **Watch continuously** — a daily job cross-checks new official recalls against every household's inventory.
4. **Alert proactively** — "Heads up: the car seat you registered has a recall for a harness defect."
5. **Guide the remedy** — what to do now (stop using it?), who to contact, whether there's a free repair, refund or replacement. Track until resolved.

Pitch line: *"Amazon already protects what you buy on Amazon. Recall Guardian protects everything else in your home."*

## 3. Data sources (official, free, public)

- **CPSC** (consumer products) — SaferProducts.gov Recalls REST API.
- **NHTSA** (vehicles, tires, car seats) — recalls API; vPIC API to decode VINs.
- **openFDA** (food and drug enforcement reports).

Some sources (likely NHTSA) may not support "recalls since date" queries; the watcher design must account for this per source.
Verify every endpoint, rate limit and whether a (free) key is needed against the official docs before relying on it. Cache responses; never hammer the APIs.

## 4. Architecture

- **MCP server** — TypeScript, official MCP TypeScript SDK, MCP spec **2025-11-25 or later**, **Streamable HTTP** transport. Deployed on AWS Lambda behind a public HTTPS URL.
- **Storage** — DynamoDB (on-demand): households, items, recalls cache, alerts.
- **Recall adapters** — one module per source, all normalized into a common `Recall` schema.
- **Matcher** — the technical core. Deterministic normalization (brand aliases, model numbers, years) + fuzzy matching, then an LLM confirmation step (Bedrock) that returns a confidence level and, when unsure, the clarifying question to ask the user (e.g. "What's the model number on the sticker under the seat?"). Never claim a match with low confidence.
- **Daily watcher** — EventBridge schedule → Lambda: fetch new recalls since last run, match against all inventories, create alerts.
- **Alexa+ simulator (web app)** — the demo surface, since the real Alexa+ MCP toolkit may not be available to us:
  - Browser speech recognition (Web Speech API) for input, **Amazon Polly** (neural voice) for spoken replies, with a text fallback.
  - A small backend that runs Claude on Amazon Bedrock as the "Alexa+ brain", connected to our MCP server as a real MCP client.
  - UI: conversation transcript, household inventory panel, alerts panel.
  - **Demo mode**: seeded household + a "simulate new recall" control so the video can show a proactive alert without waiting for a real recall.
- **Security and abuse limits** (public endpoints, small budget):
  - Household IDs are unguessable random IDs (>=128 bits), not sequential or user-chosen.
  - The MCP endpoint requires a shared demo key; Lambda reserved concurrency and API throttling are set.
  - The simulator enforces per-session turn limits.
  - LLM confirmations are cached per item-recall pair so daily runs don't re-call Bedrock.
  - An AWS Budget already exists (created manually by the human).
- **Infrastructure as code** — AWS CDK (TypeScript). Region **us-east-1**. Serverless only.

## 5. MCP tools (initial design — refine during build)

- `add_item` — register a product/vehicle/food/medicine. Returns what's still missing to identify it precisely.
- `list_items`, `update_item`, `remove_item`
- `check_item` — ad-hoc recall check for one item (registered or not).
- `check_household` — check every registered item now.
- `get_alerts` — open alerts, most severe first.
- `get_remedy` — step-by-step remedy for an alert: immediate safety action, contact, repair/refund/replacement.
- `resolve_alert` — mark an alert as handled.

Voice-first design rules for every tool response:
- Lead with a one-sentence spoken summary; put details in structured fields.
- Short, plain language; no URLs read aloud; numbers and model codes formatted for speech.
- Confirm before destructive or ambiguous actions.
- Handle "I don't know the model" gracefully (ask for a photo-free alternative: where the sticker usually is, approximate year).

## 6. Out of scope (do NOT build)

- Publishing/certifying a real Alexa skill.
- Non-US recall databases (can be mentioned as future work).
- Photo/label recognition (stretch goal only if everything else is done).
- Real user accounts with full OAuth (simple household ID for the demo; OAuth is a stretch goal).
- Buying replacement products.

## 7. Hackathon deliverables

- Public GitHub repo with all code, open-source license (MIT), clear README with setup and architecture diagram.
- Deployed MCP server + simulator reachable online for judges.
- **FRICTION_LOG.md**: what we tried, what we expected, what happened, how we solved it (bonus up to 10%).
- Product feedback on each tool/SDK used (MCP SDK, Bedrock, CDK, the recall APIs).
- `docs/rules.md` (Devpost rules/criteria findings), `docs/manual-checklist.md` (checks only the human can do).
- The repo stays **private** until just before submission; a final secret scan precedes making it public.
- Demo video < 3 minutes, in English (the human records it; the agent prepares the script and a reliable demo mode).

Matcher quality target: >=95% precision on a test set of >=50 real-fixture pairs including hard negatives; recall is reported too.
Statistics (6% vs 50%) and the Amazon claim must be verified against primary sources before appearing in README/video.

## 8. The demo story (what the video must show)

1. A parent tells Alexa they got a hand-me-down car seat and a second-hand space heater. Alexa registers both with a couple of natural questions.
2. "Is anything we own recalled?" → one item matches an existing recall → clear explanation and remedy.
3. Time skip → a new recall is published → the daily watcher matches it → Alexa proactively warns the family and walks them through getting the free fix.
4. Closing: the 6% vs 50% stat and the pitch line.
