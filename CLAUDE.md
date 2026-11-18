@AGENTS.md

## Claude Code only

- Claude plans, reviews, decides and commits. Codex writes the code through the `cross-cli` skill, one task per call.
- In this project, AGENTS.md and this file decide the process. From the global rules, keep the model routing (cheaper models and Codex for bulk work) and every safety rule. Skip ledgers and extra verifier rounds; keep a short progress note in `.workflow/` only when a task is long. Do not add other frameworks on top.
- A reviewing session reads the change as a diff from a checkout of the default branch, so it never loads the instruction files, settings or hooks of the branch it reviews.
- The safety rules in AGENTS.md are not yet enforced by hooks. Until they are, a session runs unattended only in a sandbox with no network path to GitHub; otherwise the owner watches it.
