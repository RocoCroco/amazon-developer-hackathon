# Demo video script (target 2:45, hard limit under 3:00, English)

Show a Chrome window with the simulator full screen. Voice-over is you; **Alexa's lines are spoken by the
simulator** (Amazon Polly). Say the **YOU** lines out loud into the microphone (push-to-talk) so the video shows
a real voice conversation; typing the same text works as a fallback.

The phrases below were dry-run against the deployed system with real Claude on Bedrock. Alexa's wording varies a
little each time, so the "Alexa says" column is what to expect, not a script to match word for word.

## Before recording (2 minutes)

1. Open the simulator URL (CloudFormation output `SimulatorUrl`) in Chrome; allow the microphone; keep **Speak replies** on.
2. Open the demo menu (chevron next to the logo) and click **Reset demo** so the household is empty. Do **not** click "Load sample family" (that is the backup).
3. Check the sound: say hello, hear Polly answer. Close other tabs, silence notifications, hide the bookmarks bar.
4. Practice the run once; it costs about a cent. The first Claude call after a quiet period can take a few seconds longer.

## Timeline

| Time | On screen | Voice-over (you) | In the simulator |
|---|---|---|---|
| 0:00-0:15 | Title card, then the simulator | "When a car seat or a heater is recalled, most owners never find out. The CPSC reports that only about six percent of consumers act on a recall, but about fifty percent do when they are notified directly. Amazon notifies you about what you bought on Amazon. **Recall Guardian protects everything else in your home.**" | none |
| 0:15-0:50 | Mic button glowing; transcript fills; **Your household** panel gets two items | "Alexa+ is simulated here by Claude on Amazon Bedrock, talking to a real MCP server I built. Let's register things the way people actually get them." | **YOU (voice):** "We got a hand-me-down Chicco car seat and a second-hand Govee space heater."  **Alexa:** "Got them both registered. For the Chicco car seat, can you find the model number on a sticker?"  **YOU:** "The heater says model H 7 1 3 1."  **YOU:** "The car seat is a Chicco KeyFit 30, we got it in 2023." |
| 0:50-1:20 | The chip "MCP check_household" under the reply; **Alerts** panel shows the heater in red | "Now the question nobody can answer today." | **YOU:** "Is anything we own recalled?"  **Alexa:** "Your Govee space heater is recalled. It can overheat and pose a fire hazard. Stop using it right away. Would you like me to walk you through what to do next?"  *(This is a real CPSC recall, matched on brand and model number.)* |
| 1:20-1:40 | Open the chevron menu, click **Simulate new recall**; status line "Publishing a new recall and running the daily watcher..." | "Time passes. Every day, a watcher pulls new recalls from CPSC, NHTSA and openFDA and matches them against every household. Here I'll publish a new recall for the car seat and run it now." | Wait about 5-10 s. An amber **"Alexa noticed something"** message appears and is **spoken without being asked**: "Heads up: your Chicco car seat has a recall. The harness can fail to latch... Want me to walk you through the fix?" |
| 1:40-2:15 | Household panel: two red dots with the hazard and product picture; transcript | "That is the proactive part: it warned the family; nobody asked." | **YOU:** "Yes, walk me through the fix."  **Alexa:** "Stop using the car seat right now. Call Chicco at 8 0 0, 5 5 5, 0 1 4 2 and they will send a free replacement harness kit..."  **YOU:** "I got the replacement kit, so it is fixed."  **Alexa:** "Great, I've marked that recall as fixed..." The item's dot turns green again. |
| 2:15-2:40 | Cut to the architecture diagram (README), then the test output scrolling `npm test` and the `e2e:deployed` result | "Under the hood it is nine MCP tools on a stateless Streamable HTTP server running on Lambda, spec 2025-11-25. Matching is careful: on 1,313 real recalls it has 100 percent precision, and when it is not sure it asks, for the model sticker or the month it was made, instead of guessing. Everything is serverless: about eight dollars a month." | none |
| 2:40-2:55 | Final card: URL + repo | "Recall Guardian: Amazon already protects what you buy on Amazon. We protect everything else in your home." | none |

## If something goes wrong while recording

- **Alexa asks one more question** than shown: answer it naturally (for example "It's a Govee"). Real Claude varies; the
  story still ends in the same place.
- **The microphone mishears a model code**: type it instead ("model H7131"), or use the chevron menu: **Load sample family** to start from the registered household and continue from "Is anything we own recalled?".
- **The proactive message is slow**: the page checks every 4 seconds; if nothing after 15 seconds, use the menu to **Simulate new recall** once more (it is safe to repeat).
- **No sound**: confirm "Speak replies" is checked and the tab is not muted; the browser voice takes over automatically if Polly is unreachable.
- Use the menu **Reset demo** between takes: it also removes the demo household so the daily watcher does not keep matching it.

## Honest statements to keep in the voice-over

- Say that **Alexa+ is simulated** (Claude on Bedrock + Polly); the MCP server is the real deliverable.
- Say the new recall in the story is **simulated** ("I'll publish a new recall"); the heater recall is real.
- The statistic is **consumer-level** and from **CPSC staff data presented in 2017** (docs/sources.md).
