import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { decideCommand } from "../claude/commands.ts";
import { DROP, routeRequirement } from "./route.ts";

test("repeat, alias, export and every other shell word on the list drop the route and are refused at the hook", () => {
  for (const program of "repeat foreach select case if while until for function alias unalias hash rehash enable disable functions unfunction autoload zmodload emulate setopt unsetopt set shopt export typeset declare local readonly unset fc r cd pushd popd ulimit umask".split(
    " ",
  )) {
    const pattern = `${program} *`;
    const route = routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [pattern] }), {
      hooks: true,
      chrome: false,
    });
    expect(route, program).toMatchObject({ routed: false, reason: DROP.runsAnything });
    expect(decideCommand({ patterns: [pattern] }, { command: `${program} echo` }), program).toEqual({
      allow: false,
      reason: DROP.runsAnything,
    });
  }
});
