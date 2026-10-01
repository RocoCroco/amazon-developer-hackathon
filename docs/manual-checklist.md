# Manual checklist (only you can do these)

- [x] Bedrock access (done; live tests pass). Lambda concurrency quota raised to 1000 and reserved concurrency applied.
- [ ] **Voice in Chrome** (needs a real microphone): open the simulator (`SimulatorUrl` stack output), allow the mic, say "We got a hand-me-down Chicco car seat and a second-hand Govee space heater"; check transcript, Polly reply, that "Speak replies" off silences it.
- [ ] Polly voice: `POLLY_VOICE_ID` (default Joanna, neural, set on the simulator Lambda env); try Ruth/Kendra/Salli and pick the one that sounds most like Alexa.
- [ ] (Optional) MCP Inspector against the deployed server: URL = `McpUrl` output; headers `Authorization: Bearer <demo key>` and `X-Household-Id: <22+ random base64url chars>`. Key: `MSYS_NO_PATHCONV=1 aws ssm get-parameter --name /recall-guardian/demo-key --with-decryption --region us-east-1 --query Parameter.Value --output text`.
- [ ] Rehearse and **record the demo video** (< 3 min, English, YouTube/Vimeo) with docs/video-script.md; upload; paste the link into docs/devpost-submission.md.
- [ ] **Repo visibility (T7.2):** the secret scan is clean (docs/secret-scan.md). Make it public, or share with the judging team, right before submitting (Open Source mini challenge needs public). `gh repo edit --visibility public --accept-visibility-change-consequences`.
- [ ] **Fill in the Devpost form** (docs/devpost-submission.md: track Alexa+, mini challenges, description, video, repo, feedback = FEEDBACK.md, friction log = FRICTION_LOG.md) before Oct 23, 2026 12:00 PT.
- [ ] Decide whether to keep the public simulator open after judging (daily caps 600 model turns, 120k spoken chars); `cd infra && npx cdk destroy` removes everything.
- [ ] Final sanity run the day before: `npm run e2e:deployed`.
