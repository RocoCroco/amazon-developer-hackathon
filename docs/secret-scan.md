# Final secret scan (T7.1), 2026-10-01

Run over the working tree and the full git history (all branches) before making the repo public:

- Tracked or historical files named like `.env*`, `credentials`, `*.pem`, `*.key`, `.aws*`: none.
- Patterns in every commit's diff: AWS access key ids (`AKIA`/`ASIA`), `aws_secret_access_key`, private key blocks,
  GitHub/Slack/OpenAI-style tokens: none.
- The shared demo key (read from SSM at scan time, never printed): 0 occurrences in history and in any file.
- The AWS account id: not present in the repository.
- Public values that are intentionally in the repo: the simulator Function URL (rate-limited by daily caps), the stack's
  resource names. The MCP URL needs the demo key and household header.

Re-run before flipping the repo public if anything was committed since (commands are in this file's git history / PROGRESS.md).
