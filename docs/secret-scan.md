# Secret scan

Last run: **2026-10-07**, before making the repository public, over the working tree, the staged changes and the
full git history (all branches, every commit's diff). First run: 2026-10-01 (T7.1).

## Result: nothing sensitive found

| Check | How | Result |
|---|---|---|
| Sensitive file names | every path ever committed, matched against `.env*`, `credentials`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `.aws/`, `secret` | none (only this document) |
| Credential patterns | every diff in history, the staged changes and the tree, matched against AWS access key ids (`AKIA…`, `ASIA…`), `aws_secret_access_key`, private key blocks, GitHub tokens (`ghp_`, `gho_`, `github_pat_`, …), Slack tokens, OpenAI/Anthropic-style keys, Google API keys | none (the only match is this document's own list of patterns) |
| The shared demo key | read from SSM Parameter Store into a shell variable (never printed) and searched for as a fixed string | 0 occurrences in history, 0 in the tree |
| The AWS account id | read with `aws sts get-caller-identity` and searched for as a fixed string | 0 occurrences in history, 0 in the tree |
| Video files and large binaries | every blob ever committed, by size and extension (`mp4`, `mov`, `webm`, `wav`, `mp3`, `zip`, `onnx`, …) | no media or archives ever committed; the largest blobs are design images of about 1.7 MB |

## Public on purpose

- The simulator's Function URL (the live demo): protected by daily spending caps shared by all containers.
- The MCP server's Function URL: it requires the demo key and a household id header.
- The CloudFormation resource names in the stack outputs.
- Email addresses and phone numbers inside `packages/mcp-server/test/corpus` and `test/fixtures`: they are the
  manufacturers' recall contacts, copied unchanged from public CPSC recall records.

## Worth knowing (not secrets)

- Commit metadata: the commits are authored with the maintainer's name and email, as git records them. They become
  visible when the repository is public; changing them would mean rewriting history.
- Older versions of `docs/process/PROGRESS.md` (in history, not in the current tree) mention a local folder path
  (`C:/Users/<name>/Documents/...`), which only reveals the Windows user name, the same as the GitHub handle.

## How to re-run

From the repository root, in Git Bash:

```bash
# 1. sensitive file names, in the tree and in every commit
{ git ls-files; git log --all --pretty=format: --name-only; } | sort -u \
  | grep -iE "(^|/)\.env|credentials|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|\.aws/|secret"

# 2. credential patterns in every diff, the staged changes and the tree
P='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws_secret_access_key|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_|xox[abposr]-|sk-[A-Za-z0-9]{32,}|sk-ant-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}'
git log --all -p --no-color | grep -nE "$P"; git diff --staged | grep -nE "$P"; git grep -nE "$P"

# 3. real values, read into variables and never printed; each count must be 0
K=$(aws ssm get-parameter --region us-east-1 --name /recall-guardian/demo-key --with-decryption --query Parameter.Value --output text)
A=$(aws sts get-caller-identity --query Account --output text)
for v in "$K" "$A"; do git log --all -p --no-color | grep -cF "$v"; git grep -cF "$v" | wc -l; done
unset K A

# 4. largest blobs ever committed
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob"' | sort -k3 -n -r | head
```
