# Upwork job review

This flow reads Upwork job alerts in Gmail, reviews them against your profile, and lets you pick jobs for a prototype and a proposal draft. It never sends a message and never publishes a prototype.

Write your profile in `~/job-review/notes/profile.md` before you run the flow. On the flow's screen, allow the Gmail tools, read-only access to the job pages and notes, your `prototype-builder` skill, the work and prototype folders, and the seven listed Flutter and Dart commands.

Each picked job waits for you to approve its build plan as your own words. Your approval lets the build step run those seven commands from that plan. Each prototype is built in `~/job-review/prototypes/<job id>/`. The proposal is saved in your work folder with a placeholder for its link.

For the first run, set `newest` to 3.
