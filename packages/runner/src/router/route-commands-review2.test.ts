import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { decideCommand } from "../claude/commands.ts";
import { DROP, routeRequirement } from "./route.ts";

test("noglob, nocorrect and a program word starting with - drop the route and are refused at the hook", () => {
  for (const program of ["noglob", "nocorrect", "-", "-command"]) {
    const pattern = `${program} *`;
    const route = routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [pattern] }), {
      hooks: true,
      chrome: false,
    });
    expect(route).toMatchObject({ routed: false, reason: DROP.runsAnything });
    expect(decideCommand({ patterns: [pattern] }, { command: `${program} echo` })).toEqual({
      allow: false,
      reason: DROP.runsAnything,
    });
  }
  expect(decideCommand({ patterns: ["git *"] }, { command: "git rm notes.md" })).toEqual({
    allow: false,
    reason: DROP.riskyCommand,
  });
});
