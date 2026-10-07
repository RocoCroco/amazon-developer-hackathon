# Devpost submission text (paste-ready)

**Project name:** Recall Guardian
**Tagline:** Amazon already protects what you buy on Amazon. Recall Guardian protects everything else in your home.
**Track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP)
**Mini challenges:** AWS Builder (serverless on AWS, Bedrock, Polly, Transcribe, CDK) and Open Source (the Open Recall Format, see the last section).

**Links**
- Demo video: _(YouTube/Vimeo link, filled in by the human)_
- Live simulator: https://6aqlg4s33zg7tgjhoqsetxjqyi0pctry.lambda-url.us-east-1.on.aws/ (in Chrome or Edge allow the microphone once and say "Alexa, we got a second-hand Govee space heater, model H7131", or type it; the settings behind the gear icon have "Load sample family" and "Simulate new recall")
- Code: _(GitHub URL; MIT license)_

---

## Inspiration

When a car seat, a space heater or a dresser is recalled, most owners never find out. At the CPSC's 2017 Recall
Effectiveness Workshop, agency staff reported that only about **6% of consumers** act on a recall announced by press
release, versus about **50%** when they are notified directly. The CPSC's own report on the workshop names *home voice
assistants* as one way to get direct notice to people.

Amazon already notifies customers about recalls of products bought on Amazon. But gifts, second-hand and hand-me-down
baby gear, in-store purchases, cars, food and medicine are invisible to that system, because nobody knows who owns
what. People don't fill in registration cards; they do talk to their assistants. So: what if registering a product was
a sentence, and the assistant did the watching?

## What it does

Recall Guardian is an MCP server that turns Alexa+ into a recall guardian for the whole home.

- **Register by voice, hands-free:** "Alexa, we were gifted a dresser and a Chicco car seat." Alexa asks only what it needs (brand, model, roughly when it was made) and checks the moment it knows enough.
- **Hear brands right:** speech recognition writes the dresser brand "Aitjunz" as "iTunes" or "8th June". The server compares what it heard by sound with the brands in the official recall data and asks "Do you mean Aitjunz, A-I-T-J-U-N-Z?"; the owner can also spell it.
- **Know the family:** "Leo is allergic to peanuts." A food recall for undeclared peanuts says it matters for Leo and goes to the top; "any recent peanut recalls?" is answered from openFDA.
- **Check instantly:** "Is anything we own recalled?" The server matches the household against official CPSC (consumer products), NHTSA (vehicles, child seats) and openFDA (food, drugs) data.
- **Watch continuously:** a daily job pulls new recalls and matches them against every household.
- **Alert proactively:** "Heads up: your car seat has a recall for a harness defect." No one asked.
- **Guide the fix:** safety action first ("stop using it"), then the free repair, replacement or refund, who to call (phone digits spelled for speech), and it tracks the alert until it is resolved.

The principle that shaped everything: **it never claims a recall it is not sure about.** If the model number, the month
a seat was made, or a food lot code decides the answer, it asks one short question that a person can answer without
tools ("Where is the sticker? Do you know roughly which month it was made?") instead of guessing.

## How we built it

- **A real MCP server:** TypeScript, the official `@modelcontextprotocol/sdk`, MCP spec **2025-11-25**, **Streamable HTTP** (stateless, JSON responses), on AWS Lambda behind a public HTTPS URL, with eleven tools (`add_item`, `list_items`, `update_item`, `remove_item` with confirmation, `check_item`, `check_household`, `get_alerts`, `get_remedy`, `resolve_alert`, `update_allergies`, `recent_allergen_recalls`). Every response leads with one short spoken sentence; a test drives all eleven tools and enforces voice-first rules. Brand mishearing is solved in the server (sound-alike matching against recall brands), so it helps any voice front end, not just ours.
- **The matcher is the technical core:** deterministic normalization (brand aliases, model codes, per-product model years, production windows with month precision) plus a Claude second opinion on Amazon Bedrock that can only make an answer *more* careful. Evaluated on **1,313 real recalls**: 77 hand-labeled and 478 generated items score 100%, but those labels were partly reconciled with the matcher, so we added a **blind challenge set of 40 messy descriptions** (misheard brands, partial model codes, "stove" for "range", no brand, 14 hard negatives). Blind first run: **0 false alarms, 21 of 26 recalled items handled safely**; after two general fixes 26 of 26. All of it, including what is still not ideal, is in docs/matcher-results.md.
- **Outage-proof data:** CPSC's API went down for hours while we built this (and still often refuses requests from AWS). A naive design said "no recalls" during the outage, the worst possible answer. Now every source reports when it is down, the server keeps a copy of every CPSC recall since mid-2011 in DynamoDB, and if no source can answer, Alexa says it could not check.
- **Daily watcher:** EventBridge -> Lambda. Incremental sync of four official feeds (including streaming the 15 MB NHTSA zip without buffering it), matching only new or revised recalls, deduplicated alerts that never resurrect a closed one.
- **Alexa+ simulator (the demo surface):** the real Alexa+ MCP toolkit may not be available to us, so a web app simulates it: Claude on Bedrock is the "Alexa+ brain" and is a **real MCP client** of our server; Amazon Transcribe streaming (with a custom vocabulary of recall brands) for the microphone, the browser recognizer for the wake word ("Alexa"), end-of-speech detection, follow-up listening and pause-while-speaking, like a real Echo; **Amazon Polly** neural voice, with model codes spelled out through SSML. It is stateless on Lambda (conversations and daily spending caps live in DynamoDB), with a "Simulate new recall" button that really invokes the deployed watcher.
- **Serverless on AWS, in CDK:** Lambda, DynamoDB on-demand, EventBridge, Bedrock, Polly, Transcribe. About **$12 a month** at demo usage (docs/costs.md), with a CDK test that fails if a resource with an hourly price appears.

## Challenges we ran into

- **The data is messier than the docs.** CPSC model numbers live in free text; openFDA recall numbers are sometimes "N/A" (which silently merged unrelated recalls until a live-data test caught it); NHTSA has no endpoint for child seats at all, only a 311 MB daily file. We logged every one in FRICTION_LOG.md.
- **Being right about "recalled".** A year is not a date: a seat "made in 2016" may or may not fall in a Nov 2015 - Jan 2016 recall window, so the system asks for the month. "F-150" is not "F-150 Lightning". "Tablets" is not "elixir". Each of these became a test.
- **Finding our own gap.** Unit tests were green while the deployed server could not find a child-seat recall (it only searched CPSC). Designing the demo exposed it; we fixed it with a composite provider and now smoke-test one case per data source on the deployed system.

## Accomplishments we're proud of

- Never a false "your X is recalled" on 1,313 real recalls, including a blind challenge set of messy, misheard descriptions; the blind first run (80.8% of recalled items handled safely) is published next to the improved one, not polished away.
- A complete loop on real infrastructure: register by voice, check, a proactive warning from the daily watcher, a spoken walk-through of the fix, closed alert. One command (`npm run e2e:deployed`) verifies it against the deployed system with real Claude and Polly.
- Voice-first throughout: short sentences, no URLs read aloud, phone numbers and model codes spelled out, confirmation before anything destructive.

## What we learned

The MCP Streamable HTTP transport fits serverless well, because the web-standard `Request`/`Response` handler runs unchanged on Node, Lambda and in tests. Honest uncertainty ("I need one more detail") is a feature a recall product must have, and it is easier to build when the language model may only *downgrade* a deterministic match, never upgrade one.

## What's next

Real Alexa+ integration when the MCP toolkit is available (the server stays as is); OAuth 2.1 for households; filling the inventory faster (order history, receipts, a photo of the label); a larger tire/equipment backfill; non-US recall databases.

## Built with

TypeScript, Model Context Protocol (official SDK, Streamable HTTP), AWS Lambda, Amazon DynamoDB, Amazon EventBridge, Amazon Bedrock (Claude Haiku 4.5), Amazon Polly, AWS CDK, Web Speech API, Playwright, Vitest; data from CPSC SaferProducts.gov, NHTSA and openFDA.

## Product feedback and friction log

Per-tool feedback for every SDK, API and service used: FEEDBACK.md. Friction log (what we tried, what we expected, what happened, how we solved it): FRICTION_LOG.md (25 entries).

---

## Open Source mini challenge (form fields)

The rules ask for: "contribution URL, project repository URL, GitHub username, and a description of what you did,
how it works, and why it matters."

- **Project repository URL:** https://github.com/RocoCroco/open-recall-format
- **Contribution URL:** https://github.com/RocoCroco/open-recall-format/releases/tag/v0.1.0
- **GitHub username:** RocoCroco
- **Also mention:** the schema.org proposal https://github.com/schemaorg/schemaorg/issues/3229#issuecomment-5979280862

**Description (paste-ready):**

**What I did:** I created the Open Recall Format, a new open-source project: an open draft standard for product
recall data, written from the owner's side, with working code. The project includes the specification, a JSON
Schema, shared vocabularies (hazards, allergens, actions, remedies), converters for seven official recall sources (US
CPSC, NHTSA and FDA; Canada; EU Safety Gate; France RappelConso; UK OPSS), a reference checker, a CLI, and 75 tests on
real government records. I also posted a concrete `ProductRecall` proposal on schema.org's recall issue, open since
2022 (https://github.com/schemaorg/schemaorg/issues/3229#issuecomment-5979280862).

**How it works:** each converter turns an agency's own data into one record shape. The affected units become data a
program can check: model numbers, barcodes, lot codes, serial ranges, production and use-by dates, vehicle model
years. Each record also says where the code is printed on the product, what the owner should do first, and what
remedy they get. The checker answers "affected", "possibly affected" (plus the exact question to ask the owner),
"not affected" or "unrelated", and it never turns "unknown" into "not recalled".

**Why it matters:** only about 6% of consumers act on a recall announced by press release, and about 50% when they
are told directly. Telling people directly needs software that knows whether the unit in their home is affected.
Today every agency publishes in a different shape, and the identifiers are often hidden in prose: in all 134 CPSC
recalls from January to April 2025, the structured model field is empty. Recall Guardian, my Alexa+ entry, is the
first use case: an assistant that can warn a family about anything they own, not only what they bought online.
