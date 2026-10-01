# Devpost submission text (paste-ready)

**Project name:** Recall Guardian
**Tagline:** Amazon already protects what you buy on Amazon. Recall Guardian protects everything else in your home.
**Track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP)
**Mini challenges to consider:** AWS Builder (serverless on AWS, Bedrock, Polly, CDK). Open Source (needs the repo to be public; see the checklist).

**Links**
- Demo video: _(YouTube/Vimeo link, filled in by the human)_
- Live simulator: https://6aqlg4s33zg7tgjhoqsetxjqyi0pctry.lambda-url.us-east-1.on.aws/ (click "Load sample family", ask "Is anything we own recalled?", then "Simulate new recall"; Chrome for voice)
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

- **Register by voice:** "We got a hand-me-down Chicco car seat and a second-hand Govee space heater." Alexa asks only what it needs: brand, model, roughly when it was made.
- **Check instantly:** "Is anything we own recalled?" The server matches the household against official CPSC (consumer products), NHTSA (vehicles, child seats) and openFDA (food, drugs) data.
- **Watch continuously:** a daily job pulls new recalls and matches them against every household.
- **Alert proactively:** "Heads up: your car seat has a recall for a harness defect." No one asked.
- **Guide the fix:** safety action first ("stop using it"), then the free repair, replacement or refund, who to call (phone digits spelled for speech), and it tracks the alert until it is resolved.

The principle that shaped everything: **it never claims a recall it is not sure about.** If the model number, the month
a seat was made, or a food lot code decides the answer, it asks one short question that a person can answer without
tools ("Where is the sticker? Do you know roughly which month it was made?") instead of guessing.

## How we built it

- **A real MCP server:** TypeScript, the official `@modelcontextprotocol/sdk`, MCP spec **2025-11-25**, **Streamable HTTP** (stateless, JSON responses), on AWS Lambda behind a public HTTPS URL, with nine tools (`add_item`, `list_items`, `update_item`, `remove_item` with confirmation, `check_item`, `check_household`, `get_alerts`, `get_remedy`, `resolve_alert`). Every response leads with one short spoken sentence; a test drives all nine tools and enforces voice-first rules.
- **The matcher is the technical core:** deterministic normalization (brand aliases, model codes, per-product model years, production windows with month precision) plus a Claude second opinion on Amazon Bedrock that can only make an answer *more* careful. Evaluated on **1,313 real recalls**, 77 hand-labeled and 478 generated items (about 730,000 item-recall pairs): **100% strong-match precision and recall on both sets**. The evaluation is honest about itself: it found four real bugs and several of our own wrong labels along the way (docs/matcher-results.md).
- **Daily watcher:** EventBridge -> Lambda. Incremental sync of four official feeds (including streaming the 15 MB NHTSA zip without buffering it), matching only new or revised recalls, deduplicated alerts that never resurrect a closed one.
- **Alexa+ simulator (the demo surface):** the real Alexa+ MCP toolkit may not be available to us, so a web app simulates it: Claude on Bedrock is the "Alexa+ brain" and is a **real MCP client** of our server; Web Speech API for the microphone; **Amazon Polly** neural voice, with model codes spelled out through SSML. It is stateless on Lambda (conversations and daily spending caps live in DynamoDB), with a "Simulate new recall" button that really invokes the deployed watcher.
- **Serverless on AWS, in CDK:** Lambda, DynamoDB on-demand, EventBridge, Bedrock, Polly. About **$8 a month** at demo usage (docs/costs.md), with a CDK test that fails if a resource with an hourly price appears.

## Challenges we ran into

- **The data is messier than the docs.** CPSC model numbers live in free text; openFDA recall numbers are sometimes "N/A" (which silently merged unrelated recalls until a live-data test caught it); NHTSA has no endpoint for child seats at all, only a 311 MB daily file. We logged every one in FRICTION_LOG.md.
- **Being right about "recalled".** A year is not a date: a seat "made in 2016" may or may not fall in a Nov 2015 - Jan 2016 recall window, so the system asks for the month. "F-150" is not "F-150 Lightning". "Tablets" is not "elixir". Each of these became a test.
- **Finding our own gap.** Unit tests were green while the deployed server could not find a child-seat recall (it only searched CPSC). Designing the demo exposed it; we fixed it with a composite provider and now smoke-test one case per data source on the deployed system.

## Accomplishments we're proud of

- 100% strong-match precision on a corpus of real recalls, with the evaluation's history written down, not polished away.
- A complete loop on real infrastructure: register by voice, check, a proactive warning from the daily watcher, a spoken walk-through of the fix, closed alert. One command (`npm run e2e:deployed`) verifies it against the deployed system with real Claude and Polly.
- Voice-first throughout: short sentences, no URLs read aloud, phone numbers and model codes spelled out, confirmation before anything destructive.

## What we learned

The MCP Streamable HTTP transport fits serverless well, because the web-standard `Request`/`Response` handler runs unchanged on Node, Lambda and in tests. Honest uncertainty ("I need one more detail") is a feature a recall product must have, and it is easier to build when the language model may only *downgrade* a deterministic match, never upgrade one.

## What's next

Real Alexa+ integration when the MCP toolkit is available; OAuth 2.1 for households; photo of the product label to read the model number; live openFDA lookup and a larger tire/equipment backfill; non-US recall databases.

## Built with

TypeScript, Model Context Protocol (official SDK, Streamable HTTP), AWS Lambda, Amazon DynamoDB, Amazon EventBridge, Amazon Bedrock (Claude Haiku 4.5), Amazon Polly, AWS CDK, Web Speech API, Playwright, Vitest; data from CPSC SaferProducts.gov, NHTSA and openFDA.

## Product feedback and friction log

Per-tool feedback for every SDK, API and service used: FEEDBACK.md. Friction log (what we tried, what we expected, what happened, how we solved it): FRICTION_LOG.md (12 entries).
