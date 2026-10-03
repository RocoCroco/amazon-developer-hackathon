# Manual checklist (only you can do these)

- [x] Bedrock access (done; live tests pass). Lambda concurrency quota raised to 1000 and reserved concurrency applied.
- [ ] **Voice in Chrome and Edge** (needs a real microphone): open the simulator (`SimulatorUrl` stack output), tap the mic once and allow it. Then, hands-free: say "Alexa, we got a hand-me-down Chicco car seat and a second-hand Govee space heater" and stop talking; it should send by itself after about a second of silence, answer with Polly, and **not** react to its own voice. Say something without "Alexa": nothing should happen. Leave the tab open a few minutes and check it still reacts (Chrome stops recognition now and then; the page restarts it). Settings: "Speak replies" off silences it; "Hands-free" off stops listening (the tap-to-talk button still works).
- [ ] **Misheard brand**: say "Alexa, we were gifted an eight-drawer dresser", then "It's an Aitjunz"; Alexa should ask "do you mean Aitjunz, A-I-T-J-U-N-Z?". Note what the recognizer wrote (it is shown in your bubble) and add it to FEEDBACK.md if it is a new variant.
- [ ] **Firefox**: the mic is disabled with "Voice input needs Chrome or Edge", typing works.
- [ ] **Phone**: open the URL on a phone; check the layout, scrolling the chat, and the settings pop-up.
- [ ] Polly voice: `POLLY_VOICE_ID` (default Joanna, neural, set on the simulator Lambda env); try Ruth/Kendra/Salli and pick the one that sounds most like Alexa.
- [ ] (Optional) MCP Inspector against the deployed server: URL = `McpUrl` output; headers `Authorization: Bearer <demo key>` and `X-Household-Id: <22+ random base64url chars>`. Key: `MSYS_NO_PATHCONV=1 aws ssm get-parameter --name /recall-guardian/demo-key --with-decryption --region us-east-1 --query Parameter.Value --output text`.
- [ ] Rehearse and **record the demo video** (< 3 min, English, YouTube/Vimeo) with docs/video-script.md; upload; paste the link into docs/devpost-submission.md.
- [ ] **Repo visibility (T7.2):** the secret scan is clean (docs/secret-scan.md). Make it public, or share with the judging team, right before submitting (Open Source mini challenge needs public). `gh repo edit --visibility public --accept-visibility-change-consequences`.
- [ ] **Fill in the Devpost form** (docs/devpost-submission.md: track Alexa+, mini challenges, description, video, repo, feedback = FEEDBACK.md, friction log = FRICTION_LOG.md) before Oct 23, 2026 12:00 PT.
- [ ] Decide whether to keep the public simulator open after judging (daily caps 600 model turns, 120k spoken chars); `cd infra && npx cdk destroy` removes everything.
- [ ] Final sanity run the day before: `npm run e2e:deployed`.
