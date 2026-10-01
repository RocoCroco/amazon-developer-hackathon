# Manual checklist (things only the human can verify or do)

Agents add items here instead of blocking. Tick when done.

- [ ] Enable Bedrock model access (Claude) in us-east-1 (BLOCKERS B1).
- [ ] Open the deployed MCP URL in MCP Inspector (with the demo key) and confirm tools list.
- [ ] Try the simulator by voice in Chrome (mic permission, Polly replies audible).
- [ ] Decide repo visibility / share with judging team (BLOCKERS B2) after the final secret scan.
- [ ] Record the demo video (< 3 min, English, YouTube/Vimeo) using docs/video-script.md.
- [ ] Fill in the Devpost form (track, mini-challenges, description, links, feedback).
- [ ] Request a Lambda "Concurrent executions" quota increase in Service Quotas (us-east-1) - BLOCKERS B3.
- [ ] To use the deployed MCP server in MCP Inspector: URL = the `McpUrl` stack output; headers `Authorization: Bearer <demo key>` and `X-Household-Id: <any 22+ char random base64url string>`. Get the key with: `aws ssm get-parameter --name /recall-guardian/demo-key --with-decryption --region us-east-1 --query Parameter.Value --output text` (Git Bash: prefix with `MSYS_NO_PATHCONV=1`).
- [ ] Voice in Chrome (needs a real microphone; automated tests use a stubbed recognizer and audio): run the simulator, allow the microphone, tap the mic, say "We got a hand-me-down Graco car seat and a second-hand Govee space heater", confirm the transcript, the Polly voice reply, and that "Speak replies" off silences it. Check the model code is spelled out ("H 7 1 3 1") rather than read as a word.
- [ ] Polly voice choice: `POLLY_VOICE_ID` (default Joanna, neural). Listen to Joanna vs Ruth/Kendra/Salli and pick the one that sounds most like Alexa for the video.
- [ ] Open the public simulator URL (stack output `SimulatorUrl`; `aws cloudformation describe-stacks --stack-name RecallGuardianStack --region us-east-1 --query "Stacks[0].Outputs"`), click "Load sample family", ask "Is anything we own recalled?", then "Simulate new recall" and confirm the spoken proactive warning. `node scripts/verify-simulator.mjs` does all of this except hearing it.
- [ ] Decide whether to keep the public simulator URL open after the judging period (daily caps: 600 model turns and 120,000 spoken characters; `cdk destroy` removes everything).
