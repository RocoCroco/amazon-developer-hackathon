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
