# Strict judge review (T9.15)

Written as a skeptical Alexa+ track judge would read the submission on 2026-10-03: the four equally weighted
criteria from [rules.md](rules.md), what would cost points, ranked by impact on the score, and what was done
about each. Scores are my honest estimate *before* the fixes of this pass.

## Scores before this pass

| Criterion | Score | Why |
|---|---|---|
| Tech implementation | 7/10 | Real MCP server (spec 2025-11-25, Streamable HTTP, official SDK) on Lambda, used at runtime by a real MCP client; 400+ tests and a deployed end-to-end check. But: tools only (no output schemas), a shared demo key instead of per-household auth, and one data source (CPSC) that went down and made Alexa say "no recalls". |
| Design | 6/10 | The new UI looks like the mockups and the voice responses are short and careful. But a first-time visitor sees an empty page with no hint of what to say (the greeting was removed on purpose), the demo controls are hidden, and the video script still describes the old UI and push-to-talk. |
| Potential impact | 7/10 | Verified need (6% vs 50% correction rate, CPSC's own report suggests voice assistants), cheap to run, covers what Amazon's own recall emails do not. But the inventory only grows by voice, and the path from simulator to a real Alexa+ is not explained concretely. |
| Quality of idea | 8/10 | Proactive, household-level recall protection is a natural Alexa+ job, and "asks instead of guessing" shows understanding of voice. Food allergies make it personal. The pitch claims "100% precision", which a judge will distrust. |

## Weaknesses, ranked by impact on the score

1. **The video and the Devpost text are out of date and over-claim.** Judges score mostly from the 3-minute video.
   It still shows push-to-talk and the chevron menu, says "nine MCP tools" and "100 percent precision", and misses
   the strongest new moments: hands-free "Alexa", a misheard brand confirmed by spelling, the food-allergy warning.
   *Fixed:* new script (docs/process/video-script.md), Devpost text and README updated; precision is stated with the blind
   challenge-set numbers.
2. **A recall source outage turned into "no recalls found".** For a safety product this is the worst possible
   answer, and CPSC really was down for hours on 2026-10-03. *Fixed (T9.16):* `source_unavailable` answers, a full
   CPSC copy in the recall cache (backfill by recall-date windows), the cache covers CPSC outages.
3. **First-time visitors do not know what to say.** A judge opening the URL sees a photo and an empty input.
   *Fixed:* the empty household panel and the input suggest real first sentences ("Alexa, we got a second-hand
   Graco car seat"), and a one-line hint explains hands-free; Alexa still never speaks first.
4. **"How would this run on a real Alexa+?" is unanswered.** *Fixed:* README section "From simulator to Alexa+"
   explains what is real (the MCP server, unchanged), what the simulator stands in for (the assistant, speech,
   notification delivery), and what is missing (per-household OAuth, proactive delivery through the assistant's
   notifications), without claiming any Alexa+ API we have not used.
5. **Confidence claims a judge will not trust.** "100% precision" on sets whose labels were reconciled with the
   matcher. *Fixed (T9.13):* blind challenge set with the honest first-run number (80.8% of recalled items handled
   safely, 0 false alarms) published next to the improved one.
6. **Auth is a shared demo key**, not OAuth per household. *Not fixed in this pass* (stretch S1): documented as the
   first production gap. Household ids are unguessable 128-bit values and every request is rate limited.
7. **Inventory grows only by voice.** A real product would import order history, receipts or a label photo
   (stretch S2). *Documented* in the roadmap; out of scope for the demo.
8. **MCP surface is tools only.** No resources or output schemas. Every tool already returns `structuredContent`
   with a short spoken summary, which is what a voice client needs. *Not fixed*; low impact compared with 1-5.
9. **Privacy of hands-free listening.** Chrome's speech recognition sends audio to Google; the page listens
   continuously once allowed. *Fixed:* stated in the README and the settings dialog; hands-free can be switched off.
10. **Costs doc predates the CPSC cache and openFDA lookups.** *Fixed:* docs/costs.md updated.

## Scores I expect after this pass

| Criterion | Score | What moved it |
|---|---|---|
| Tech implementation | 8/10 | Outage-proof data path, phonetic brand matching in the server, 11 tools with tests |
| Design | 8/10 | Mockup UI, hands-free wake word, first-run hints, a video that shows the real experience |
| Potential impact | 8/10 | Food allergies (a daily worry for many families) and a concrete path to Alexa+ |
| Quality of idea | 8/10 | Unchanged idea, but now argued with honest numbers |

What would still raise the score: per-household OAuth (S1), a label-photo flow (S2), and a recorded video where a
real person talks hands-free through the whole story.
