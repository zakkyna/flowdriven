import { expect, test } from "vitest";
import { classifyCommand } from "./risky.ts";

test("git checkout, git restore, git stash drop and clear, and git worktree remove are a delete, and git switch, git stash, git worktree list and git status are not", () => {
  for (const command of [
    "git checkout .",
    "git checkout notes.md",
    "git restore .",
    "git stash drop",
    "git stash clear",
    "git worktree remove wt",
    "git -C dir checkout .",
    "git --git-dir dir restore .",
  ])
    expect(classifyCommand(command), command).toBe("delete");
  for (const command of ["git switch main", "git stash", "git worktree list", "git status"])
    expect(classifyCommand(command), command).toBeUndefined();
});
