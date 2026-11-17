import { expect, test } from "vitest";
import { classifyCommand } from "./risky.ts";

test("classifyCommand calls git branch -D, git branch --delete, git tag -d, git rm and npm unpublish a delete", () => {
  for (const command of [
    "git branch -D main",
    "git branch --delete main",
    "git tag -d v1",
    "git rm notes.md",
    "npm unpublish pkg",
    "git -C dir rm notes.md",
    "git -c key=value branch -vd main",
    "git --no-pager tag -vD v1",
  ])
    expect(classifyCommand(command)).toBe("delete");
});

test("git branch, git tag, git -C dir status and git rmdir-like words stay undefined", () => {
  for (const command of [
    "git branch main",
    "git tag v1",
    "git -C dir status",
    "git -c key=value status",
    "git rmdir",
    "git rmthing",
    "git branch -v main",
    "git tag --describe v1",
  ])
    expect(classifyCommand(command)).toBeUndefined();
});
test("the value after --git-dir, --work-tree, --namespace, --super-prefix or --config-env is not read as the subcommand", () => {
  for (const option of ["--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]) {
    expect(classifyCommand(`git ${option} x rm notes.md`)).toBe("delete");
    expect(classifyCommand(`git ${option} x status`)).toBeUndefined();
  }
});
