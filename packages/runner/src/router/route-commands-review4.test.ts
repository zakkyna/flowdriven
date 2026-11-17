import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { decideCommand } from "../claude/commands.ts";
import { DROP, routeRequirement } from "./route.ts";

const route = (command: string) =>
  routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [command] }), {
    hooks: true,
    chrome: false,
  });

test("git config drops the route and is refused at the hook, whatever follows it", () => {
  for (const command of [
    "git config",
    "git config core.pager sh",
    "git config core.hooksPath hooks",
    "git -C dir config user.name",
  ]) {
    expect(route(command), command).toMatchObject({ routed: false, reason: DROP.runsAnything });
    expect(decideCommand({ patterns: [command] }, { command }), command).toEqual({
      allow: false,
      reason: DROP.runsAnything,
    });
  }
  expect(decideCommand({ patterns: ["git *"] }, { command: "git config core.pager sh" })).toEqual({
    allow: false,
    reason: DROP.runsAnything,
  });
  expect(route("git status")).toMatchObject({ routed: true });
});

test("a command that names .git, .claude or .mcp.json in any word drops the route and is refused at the hook, in any case and after = or :", () => {
  const reason = "A step cannot run a command that names .git, .claude or .mcp.json.";
  for (const command of [
    "cp x .git/hooks/pre-commit",
    "cp x .CLAUDE/settings.json",
    "mv x .mcp.json",
    "cp x dest=.git/hooks",
    "cp x dest:.claude/settings.json",
    "cp x dest,.git/hooks",
    "cp x dest@.mcp.json",
    "cp .git/config x",
  ]) {
    expect(route(command), command).toMatchObject({ routed: false, reason });
    expect(decideCommand({ patterns: [command] }, { command }), command).toEqual({ allow: false, reason });
    const program = command.split(" ")[0] ?? "";
    expect(decideCommand({ patterns: [`${program} *`] }, { command }), command).toEqual({
      allow: false,
      reason,
    });
  }
  expect(route("cp x notes.txt")).toMatchObject({ routed: true });
});
