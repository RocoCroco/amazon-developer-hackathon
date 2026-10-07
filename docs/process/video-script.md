# Demo video script

Final video: **under 2:45**, English, the founder on screen the whole time. Face recorded on the phone, screen on
the laptop, at the same time; **clap once at the start** of every take so the two can be synced in editing.

| Part | Length | Frame |
|---|---|---|
| 1. Intro | ~20 s | Founder full frame, motion graphics on top |
| 2. Demo | ~80 s | Screen recording full frame, founder's face in a small circle (top-left corner, see 2.1) |
| 3. How it works | ~30 s | Founder on the left half, architecture diagram building up on the right |
| 4. Close | ~20 s | Founder full frame, count-up 6% -> 50%, pitch line, logo |
| Total | ~2:30 | leaves ~15 s for transitions |

Three parts below: **(1) presenter script**, **(2) demo recording script**, **(3) motion graphics brief**.

---

## 1. Presenter script

Short sentences, one per take if you like. Say them slowly; a pause between sentences makes editing easy. The
graphic column is what appears while you say the sentence (details in part 3).

### Part 1: Intro (~20 s, full frame)

| # | You say | Graphic |
|---|---|---|
| 1.1 | "If something in your home was recalled today, would you even know?" | The question types on, lower third |
| 1.2 | "Most people don't." | none |
| 1.3 | "When a recall is only announced in the news, about six percent of people act on it." | **6%** big, source line |
| 1.4 | "When they're told directly, about half of them do." | **50%** next to the 6% |
| 1.5 | "Amazon already warns you about things you bought on Amazon." | Card: "Bought on Amazon" with a check mark |
| 1.6 | "But what about gifts, second-hand things, your car, your food?" | Four chips pop in: Gifts, Second-hand, Car, Food, each with a "?" |
| 1.7 | "So I built Recall Guardian, for Alexa+." | Recall Guardian logo |

### Part 3: How it works (~30 s, founder left, diagram right)

| # | You say | Graphic (diagram step) |
|---|---|---|
| 3.1 | "Under the hood, it's a real MCP server on AWS Lambda: the kind of integration brands build for Alexa+." | Box: "Recall Guardian MCP server - AWS Lambda", tag "MCP 2025-11-25 · Streamable HTTP" |
| 3.2 | "For this demo, Alexa+ is simulated with Claude on Amazon Bedrock." | Box to its left: "Alexa+ (simulated) - Claude on Amazon Bedrock", with "Transcribe" (ears) and "Polly" (voice); arrow into the server |
| 3.3 | "The server checks official recall data from the CPSC, NHTSA and the FDA." | Three boxes on the right: CPSC, NHTSA, FDA |
| 3.4 | "When it isn't sure, it asks one short question instead of guessing." | Badge on the server box: "Asks when unsure" |
| 3.5 | "Every day, a watcher looks for new recalls and warns the family." | Clock, then box "Daily watcher", arrow back to Alexa: "Heads up" bubble |
| 3.6 | "Everything runs serverless on AWS." | The whole diagram settles; "Serverless on AWS" label |

### Part 4: Close (~20 s, full frame)

| # | You say | Graphic |
|---|---|---|
| 4.1 | "Remember: six percent." | **6%** |
| 4.2 | "With a direct warning, fifty percent." | Count-up **6% -> 50%** |
| 4.3 | "The CPSC even listed home voice assistants as a way to reach people directly." | Quote card (exact): "...registration methods or other improvements (e.g., retailer opt-in at checkout, home voice assistants, ...) to promote direct notice recalls." - CPSC Recall Effectiveness Workshop Report, Feb. 2018, p. 5 |
| 4.4 | "Amazon protects what you buy on Amazon." | Line 1 of the pitch |
| 4.5 | "Recall Guardian protects everything else in your home." | Line 2, then logo and URL |

Rules for the wording (from docs/sources.md): say **"people" or "consumers"**, never "6% of recalls"; the figures
are CPSC staff data presented in 2017, so do not say "today" or "this year" about them. "Announced in the news"
stands for a press release (the on-screen line says "announced by press release"). For 4.3, the CPSC report lists
home voice assistants among the registration methods it intends to work on to promote direct notice; do not say
the CPSC "recommends" or "endorses" voice assistants.

---

## 2. Demo recording script

Everything here was rehearsed against the deployed system with real Claude on Bedrock: **3 full runs in a row
passed every check** (`node scripts/rehearse-demo.mjs 3`, 2026-10-04), and the brand and model steps were also tried
with the ways speech recognition writes them ("8th June"; "L D Q M F J eight D B K"; "LDQ MFJ 8 DBK"). Alexa's
wording changes a little every time; the "Alexa says" column is the meaning to expect, taken from those runs.

You talk to Alexa like a normal user. **No narration in this part.**

### 2.1 Setup (5 minutes, once)

1. **Laptop:** close other apps, turn on Do Not Disturb, plug in the charger, sound on (not too loud: the phone
   records your voice).
2. **Browser:** Chrome, a fresh window, no other tabs, bookmarks bar hidden (Ctrl+Shift+B). Open the simulator URL
   (README "Live demo"). Zoom **100%** (Ctrl+0). Full screen **F11**. Record at 1920x1080 if you can.
3. **Microphone:** tap the microphone button once and allow it. From then on the page listens for "Alexa".
4. **Settings** (gear icon, top right): **Speak replies** on, **Hands-free** on, **Speech recognition: Amazon
   Transcribe**. Pick the voice you like and close the settings.
5. **Reset:** settings, **Reset demo** (empties the household). Do this before **every** take.
6. **Your face circle** goes in the **top-left** corner: the household panel is top-right, the text box bottom-left
   and the AWS / Alexa+ credits bottom-right.
7. Say "Alexa, hello." once to check the sound, then **Reset demo** again.

### 2.2 The take

Clap. Wait **2 seconds**. Between steps, wait **2 seconds after Alexa stops talking** (the ring stops moving)
before you speak. After every spoken reply Alexa keeps listening for 8 seconds, so you do not need "Alexa" again
within that time; "Thanks." ends the conversation quietly.

| Step | You say (or do) | What should appear | Alexa says (meaning) |
|---|---|---|---|
| 1 | "**Alexa, we were gifted a dresser and a Chicco KeyFit 30 car seat from 2023.**" | Your words in a blue bubble; ring lights; two items in the panel (car seat green) | "Your Chicco KeyFit 30 car seat is all clear. Who makes the dresser?" |
| 2 | "**It's an Aitjunz.**" (say it like "eight-junes"; it will be written as "8th June" or "iTunes", which is the point) | Your bubble shows the misheard brand | "Do you mean Aitjunz, spelled A-I-T-J-U-N-Z?" |
| 3 | "**Yes. The model is L D Q M F J 8 D B K.**" | The dresser turns **red** in the panel and opens with the product photo | "Your Aitjunz dresser is recalled for tip-over and entrapment hazards. Stop using it if it's not anchored to the wall, and keep children away from it. ..." |
| 4 | "**Alexa, Leo is allergic to peanuts. And we have Mercer's ice cream sandwiches in the freezer.**" | Ice cream sandwiches appear in the panel, amber | "Got it, Leo is allergic to peanuts. Your Mercer's ice cream sandwiches may have undeclared peanuts, which matters for Leo. Can you check the package for a code like 6197 or 6226?" |
| 5 | "**Thanks.**" (ends the conversation; Alexa stays quiet) | Ring goes off | (nothing) |
| 6 | Click the **gear**, then **Simulate new recall** | Status line: "A new recall was published for your Chicco car seat. The daily watcher matched it." Car seat turns red. Then, **without being asked**, Alexa speaks | "Heads up: your Chicco car seat has a recall. The harness can fail to latch, increasing the risk of injury in a crash. Want me to walk you through the fix?" |
| 7 | "**Yes, walk me through it.**" (no wake word: she is listening) | Reply bubble with MCP tool chips | "Stop using the car seat right away. Call Chicco at 8 0 0 ... for a free replacement harness kit." |
| 8 | "**I got the kit. It's fixed.**" | Car seat dot turns **green** | "Perfect, your car seat is all set." (she may go on about what is still open: cut right after "all set") |
| 9 | "**Thanks.**" | Ring off | (nothing). End of take: wait 2 seconds. |

Timing from the rehearsals: Alexa answers in 3-6 seconds; the whole take is about 2 minutes of real time. Cut
the waiting (the thinking ring) in editing to reach ~80 s. Step 4 (the peanut allergy) stays: it is the only food moment. If it is still long, shorten steps 7-8: keep only the first sentence of each of Alexa's replies there ("Stop using the car seat right away. Call Chicco ... for a free replacement harness kit." and "Perfect, your car seat is all set."), and show the green dot instead of waiting for the end of her sentence.

Honesty on screen: the recall in step 6 is published for the demo (a caption says so, part 3 of this file); the
dresser and the ice-cream recalls are real (CPSC and FDA).

### 2.3 If a step fails mid-take

Keep the camera rolling and fix it on screen when it is quick; otherwise **Reset demo** and start the take again
(it takes 10 seconds).

| Problem | What to do |
|---|---|
| Step 1: Alexa asks for the dresser's **model** instead of the brand | Say "It's an Aitjunz" anyway: she will ask "do you mean Aitjunz?" and carry on. If not, Reset and retake. |
| Step 2: the brand comes through right ("Aitjunz") | Fine: she goes straight to the model or says it is recalled after step 3. Keep going. |
| Step 3: the model comes through wrong, or Alexa asks for the **two letters after LDQMFJ8D** | Say "B K". If the mic keeps failing, click the text box and type `LDQMFJ8D-BK`, Enter. |
| Step 3: "I couldn't reach the recall database" | CPSC is down and the stored copy is too old. Stop; record later. |
| Step 6: no "Heads up" after 15 seconds | Make sure the ring is off (say "Thanks."), then **Simulate new recall** again (safe to repeat). |
| Step 7: Alexa answers about something else (the ice cream code) | Say "No, the car seat. Walk me through the car seat recall." |
| Step 8: the dot stays red | Say "I fixed the car seat recall, please close it." |
| Alexa does not hear you | Tap the microphone button and speak, or type the sentence. |
| No sound | Settings: Speak replies on; the tab is not muted. |
| "The demo has reached its daily limit" | 600 turns a day are allowed; wait until tomorrow (00:00 UTC). |

Rehearse without recording: `node scripts/rehearse-demo.mjs 1` runs the same steps in text mode (about a cent).

---

## 3. Motion graphics brief (HyperFrames project)

### Style

- Canvas 1920x1080, 30 fps. Font **Inter** (fallback Segoe UI). Colours from the simulator: navy `#0a1a3d`, blue
  `#1a66ff`, green `#2fbf5b`, red `#e5484d`, amber `#f5a524`, white text with a soft shadow on video.
- Motion: short (300-500 ms ease-out) pops and slides; nothing faster than the speech. Numbers count up, they do not
  flash. Every statistic carries a small source line (14 px, 70% white) for at least 2 seconds.
- Assets: the Recall Guardian logo (`design/assets/logo.svg`), the AWS and Alexa+ logos already in
  `packages/simulator/public/img/` (white). Architecture boxes use plain rounded rectangles; service names as text.

### Numbers allowed (from docs/sources.md only)

| Number | Wording on screen | Source line |
|---|---|---|
| 6% | "act on a recall announced by press release" | CPSC staff, Recall Effectiveness Workshop, 2017 |
| 50% | "act when told directly" | same |
| "home voice assistants" | exact quote, see 4.3 | CPSC Recall Effectiveness Workshop Report, Feb. 22, 2018, p. 5 |

(docs/sources.md also verifies: 42% of parents return car-seat registration cards; 53% of parents of young children
used pre-owned children's equipment; 600 million+ Alexa devices. Not used in this cut; available if a sentence is
added.)

### Part 1: Intro (0:00-0:20), founder full frame

| Trigger sentence | Graphic | Position | In / out |
|---|---|---|---|
| 1.1 "If something in your home..." | The question, typed on word by word | Lower third, left | In with the first word; out at 1.2 |
| 1.3 "...about six percent of people act on it." | **6%** (200 px, white), under it "act on a recall announced by press release" + source line | Right third | Count 0 -> 6 in 0.6 s on "six"; stays |
| 1.4 "...about half of them do." | **50%** (200 px, green) beside the 6%, under it "act when told directly" | Right third, next to 6% | Count 0 -> 50 on "half"; both out at the end of 1.4 |
| 1.5 "Amazon already warns you..." | Card: cart icon + "Bought on Amazon" + green check | Right third | Slide in; stays through 1.6 |
| 1.6 "...gifts, second-hand things, your car, your food?" | Chips under the card: Gifts, Second-hand, Car, Food, each with an amber "?" | Right third | One chip per word as it is said |
| 1.7 "So I built Recall Guardian..." | Logo + "Recall Guardian" + small "for Alexa+" | Centre-right | Logo scales in; out with a cut to the demo |

### Part 2: Demo (0:20-1:40), screen full frame

| Moment | Graphic | Position |
|---|---|---|
| Whole part | Founder's face in a circle, 220 px, white 4 px ring | Top-left, 40 px margin |
| Step 2 (brand misheard) | Small label: "Speech recognition heard '8th June'" with an arrow to the bubble | Near the user bubble, 3 s |
| Step 3 (dresser turns red) | Label: "Real CPSC recall" | Next to the red item, 3 s |
| Step 4 | Label: "Real FDA recall" | Next to the ice cream item, 3 s |
| Step 6 (Simulate new recall) | Caption: "Demo: a new recall is published for this video" | Bottom centre, until "Heads up" starts |
| Step 6 ("Heads up") | Label: "Nobody asked" | Near the Heads up bubble, 2 s |
| Cuts | Jump cuts over Alexa's thinking time; a 4-frame white flash is not needed, a straight cut is fine | |

### Part 3: How it works (1:40-2:10), founder left half, diagram right half

Diagram on the right half (960x1080): the server appears first in the centre, then Alexa+ on its left, the data sources on its right, the watcher above. Each element appears on its sentence and
stays.

| Trigger | Element |
|---|---|
| 3.1 | Box "Recall Guardian MCP server" with sub-line "AWS Lambda" and tag "MCP 2025-11-25 · Streamable HTTP", in the centre of the right half |
| 3.2 | Box to its left: "Alexa+ (simulated)" with sub-line "Claude on Amazon Bedrock"; two small tags under it: "Transcribe" (ear icon), "Polly" (speaker icon); arrow from Alexa+ into the server |
| 3.3 | Three small boxes stacked to the right: "CPSC", "NHTSA", "FDA"; thin lines from the server |
| 3.4 | Green badge on the server box: "Asks when unsure" |
| 3.5 | Clock icon above, box "Daily watcher (EventBridge + Lambda)", a line into the server, then an amber speech bubble near Alexa: "Heads up..." |
| 3.6 | Everything dims slightly except a bracket around it all: "Serverless on AWS" with the AWS logo |

### Part 4: Close (2:10-2:30), founder full frame

| Trigger | Graphic |
|---|---|
| 4.1 "Remember: six percent." | **6%** large, centre-right |
| 4.2 "...fifty percent." | The 6 counts up to **50%** in 1.5 s, colour turns from white to green |
| 4.3 "The CPSC even listed home voice assistants..." | Quote card, exact text: "We intend to work with consumer and industry stakeholders on registration methods or other improvements (e.g., retailer opt-in at checkout, home voice assistants, photo texting, QR codes, and incentives for product registration) to promote direct notice recalls." Highlight "home voice assistants". Source: CPSC Recall Effectiveness Workshop Report, Feb. 22, 2018, p. 5 |
| 4.4 "Amazon protects what you buy on Amazon." | Line 1, white |
| 4.5 "Recall Guardian protects everything else..." | Line 2, white with "everything else" in green; then logo, URL of the live demo, "Built on AWS · Made for Alexa+" |

### Target timing

| Part | Start | End |
|---|---|---|
| Intro | 0:00 | 0:20 |
| Demo | 0:20 | 1:40 |
| How it works | 1:40 | 2:10 |
| Close | 2:10 | 2:30 |
| Spare | 2:30 | 2:44 (hard limit) |
