# Demo video script (target 2:50, hard limit under 3:00, English)

Show a Chrome window with the simulator full screen. Voice-over is you; **Alexa's lines are spoken by the
simulator** (Amazon Polly). Talk to it **hands-free**: say "Alexa, ..." like to a real Echo; the light ring shows
it listening, thinking (a soft blue breathing) and speaking. Typing the same text works as a fallback.

Everything in the story is real data except the recall published at 1:35 (say so). The phrases were dry-run
against the deployed system with real Claude on Bedrock; Alexa's wording varies a little each time, so the "Alexa
says" column is what to expect, not a script to match word for word.

## Before recording (2 minutes)

1. Open the simulator URL (CloudFormation output `SimulatorUrl`) in Chrome. Tap the microphone once and allow it:
   from then on the page listens for "Alexa" (Settings, behind the chevron: **Hands-free** on, **Speak replies** on).
2. Settings: **Reset demo** so the household is empty.
3. Check the sound: "Alexa, hello." Close other tabs, silence notifications, hide the bookmarks bar.
4. Practice once; it costs about a cent.

## Timeline

| Time | On screen | Voice-over (you) | In the simulator |
|---|---|---|---|
| 0:00-0:15 | Title card, then the simulator (silent, a hint says what to say) | "When a dresser, a car seat or a food is recalled, most families never find out. The CPSC reports that only about six percent of consumers act on a recall, but about fifty percent do when they are told directly. Amazon tells you about what you bought on Amazon. **Recall Guardian protects everything else in your home.**" | none |
| 0:15-0:55 | Ring lights up while you talk; bubbles; the household panel fills | "This is Alexa+, simulated by Claude on Amazon Bedrock, talking to a real MCP server I built." | **YOU:** "Alexa, we were gifted an eight-drawer dresser and a Chicco KeyFit 30 car seat from 2023."  **Alexa:** "Your Chicco car seat has no recalls. Who makes the dresser?"  **YOU:** "It's an Aitjunz." *(speech recognition writes "8th June" or "iTunes")*  **Alexa:** "Just to be sure I heard the brand right: do you mean Aitjunz, A-I-T-J-U-N-Z?"  **YOU:** "Yes. The model is L D Q M F J 8 D B K." *(type it if the mic struggles)*  **Alexa:** "Your Aitjunz dresser is recalled: it can tip over and trap a child. Stop using it and keep children away..." The dresser turns **red** and unfolds with the product photo. |
| 0:55-1:05 | Zoom on the red item | "Speech recognition never gets that brand right. The server compares what it heard, by sound, with the brands in the official recall data and asks, spelling it. That's a real CPSC recall." | none |
| 1:05-1:35 | Household panel, amber then red food item | "Food matters too." | **YOU:** "Alexa, my son Leo is allergic to peanuts. And we have Mercer's ice cream sandwiches in the freezer."  **Alexa:** "Got it, I'll watch for undeclared peanuts. Your Mercer's ice cream sandwiches may be part of a food recall: it has undeclared peanuts, and Leo is allergic to peanuts. Can you read me the lot code on the box?" *(a real FDA recall from September 2026)* |
| 1:35-2:00 | Settings: **Simulate new recall**; then the ring speaks on its own | "Time passes. A daily watcher pulls new recalls from CPSC, NHTSA and openFDA. Here I publish a pretend recall for the car seat and run it now." | Wait 5-10 s: an amber **"Alexa noticed something"** message is **spoken without being asked**: "Heads up: your Chicco car seat has a recall... Want me to walk you through the fix?" |
| 2:00-2:20 | Transcript | "It warned the family; nobody asked." | **YOU:** "Alexa, yes, walk me through it."  **Alexa:** "Stop using the car seat now. Call Chicco at 8 0 0... for a free replacement kit."  **YOU:** "Alexa, I got the kit, it's fixed."  **Alexa:** "Great, I've closed that alert." The dot turns green. |
| 2:20-2:45 | README architecture diagram, then `docs/matcher-results.md` challenge table, then `npm test` output | "Under the hood: eleven MCP tools on a stateless Streamable HTTP server, spec 2025-11-25, on Lambda. It never says 'no recalls' when a government database is down: CPSC went down while I built this, so the server keeps its own copy. And I tested it against forty messy, blind-labeled descriptions: zero false alarms. Everything is serverless, about nine dollars a month." | none |
| 2:45-2:55 | Final card: URL + repo | "Recall Guardian: Amazon protects what you buy on Amazon. We protect everything else in your home." | none |

## If something goes wrong while recording

- **Alexa asks one more question** than shown: answer it naturally. Real Claude varies; the story ends in the same place.
- **The brand comes through right** (no mishearing): Alexa goes straight to the model question. Keep going; say in the voice-over that it usually comes back as "8th June".
- **The model code is misheard**: type it ("LDQMFJ8D-BK").
- **The proactive message is slow**: the page checks every 4 seconds; after 15 seconds, run **Simulate new recall** once more (safe to repeat).
- **"I couldn't reach the recall database"**: CPSC is down and the cache copy is older than a week; this is the honest answer. Record later.
- **No sound**: check "Speak replies" in Settings and that the tab is not muted.
- **Backup path**: Settings, **Load sample family** (heater + car seat), then "Alexa, is anything we own recalled?".
- Use **Reset demo** between takes: it also removes the demo household so the watcher does not keep matching it.

## Honest statements to keep in the voice-over

- Say that **Alexa+ is simulated** (Claude on Bedrock + Polly); the MCP server is the real deliverable.
- Say the recall at 1:35 is **published by you for the demo**; the dresser and ice-cream recalls are real.
- The statistic is **consumer-level** and from **CPSC staff data presented in 2017** (docs/sources.md).
- "Zero false alarms" is on a 40-item blind set; do not say "100 percent".
