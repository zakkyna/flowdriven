@AGENTS.md

## Claude Code only

- Claude plans and reviews. Plan tasks are executed by Codex, one task per call, under the handoff rules in AGENTS.md.
- A reviewing session reads a change as a diff from a checkout of the default branch and does not load the rules of the branch it reviews.
- Hooks and permission deny rules for the "Never do" list come with a later, owner-approved plan. Until then those rules are advice: a session without hard controls runs unattended only inside a sandbox with no network path to GitHub, and otherwise the owner watches it (spec 17.4).
