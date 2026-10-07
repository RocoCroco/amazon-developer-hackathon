# Pre-submission cleanup (T11.4)

To do right before making the repository public and submitting (T7.2). Audited on 2026-10-04 over the 215 tracked
files. **Nothing sensitive was found**: no AWS keys, no account number, no email, no local paths; the only URL is the
public demo. The cleanup is about leaving judges a tidy repository, not about secrets. This file is itself on the
list to delete.

Note: deleting a file does not remove it from git history. That is fine here because nothing in the history is
sensitive (the secret scan in docs/secret-scan.md covers every commit; run it once more before going public).

## 1. Remove (recommended)

| File(s) | Why |
|---|---|
| `design/screenshots/Screenshot 2026-10-03 114015.png` | An old test screenshot of the "8th June" brand bug (since fixed) |
| `design/assets/echo-thinking-1.png`, `echo-thinking-2.png` | Unused (only `echo-off.png` and `echo-listening.png` feed scripts/build-images.mjs) |
| `design/mockups/mockup-alert.png`, `mockup-register.png` | Early mockups, not referenced anywhere |
| `docs/images/sim-*.png` (15 files) | Design-review screenshots, not referenced anywhere. Replace with 2-3 fresh ones used in the README (see section 3) |
| `docs/process/judge-review.md` | Our internal self-review against the judging criteria: useful while building, reads like private notes |
| `docs/process/pre-submission-cleanup.md` | This file |

## 2. Decide (your call)

| File(s) | Keep | Remove |
|---|---|---|
| `CLAUDE.md`, `SPEC.md`, `TASKS.md`, `PROGRESS.md`, `BLOCKERS.md` | Transparent about how it was built (AI agent working from a spec and task list) | They are process notes; PROGRESS.md and BLOCKERS.md in particular are internal hand-off notes. Suggestion: keep SPEC.md and TASKS.md, remove PROGRESS.md and BLOCKERS.md; CLAUDE.md your call |
| `docs/process/manual-checklist.md`, `docs/process/video-script.md` | Show how it was tested and presented | Internal; not needed once the video is done |
| `docs/rules.md` | Shows we followed the rules exactly | A copy of Devpost's rules; judges know them |
| `docs/process/devpost-submission.md` | Harmless | Its content is on Devpost anyway |
| `docs/open-recall-format.md` | History of the design | Superseded by https://github.com/RocoCroco/open-recall-format; could shrink to a 3-line pointer |

Keep for sure: `README.md`, `LICENSE`, `FEEDBACK.md` and `FRICTION_LOG.md` (required deliverables),
`docs/architecture.md`, `docs/challenges.md`, `docs/costs.md`, `docs/data-sources.md`, `docs/impact.md`,
`docs/matcher-results.md`, `docs/sources.md`, `docs/secret-scan.md`, all code, tests, fixtures and `scripts/` (each
script is used by tests, deployment or to rebuild data).

## 3. After removing

1. Fix the links that pointed to removed files: README documentation index (judge-review, open-recall-format),
   TASKS.md / SPEC.md references if those stay.
2. Take fresh screenshots with the logos (`node scripts/shoot-simulator.mjs <url> docs/images`), keep 2-3 (desktop
   with a recall, phone), and update `docs/images/simulator.png` in the README.
3. Refresh `docs/process/devpost-submission.md` numbers if anything changed, and paste it into Devpost.
4. `npm run lint`, `npm test`, `npm run e2e:deployed`.
5. Run the secret scan over the whole history again (docs/secret-scan.md), then make the repository public (T7.2).
