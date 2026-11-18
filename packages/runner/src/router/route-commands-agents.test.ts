import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { decideCommand } from "../claude/commands.ts";
import { DROP, routeRequirement } from "./route.ts";

const route = (command: string) =>
  routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [command] }), {
    hooks: true,
    chrome: false,
  });

const refused = (command: string) => {
  expect(route(command), command).toMatchObject({ routed: false, reason: DROP.runsAnything });
  if (!command.includes("*"))
    expect(decideCommand({ patterns: [command] }, { command }), command).toEqual({
      allow: false,
      reason: DROP.runsAnything,
    });
};

test("codex, claude, gemini, agy, copilot and the other AI agent programs drop the route and are refused at the hook", () => {
  for (const program of "codex claude gemini agy copilot opencode aider goose cursor-agent amp crush qwen".split(
    " ",
  )) {
    refused(`${program} *`);
    refused(`${program} prompt`);
  }
});

test("flutter build web --release and dart format lib test still route as exact lines", () => {
  for (const command of ["flutter build web --release", "dart format lib test"]) {
    expect(route(command), command).toMatchObject({ routed: true });
    expect(decideCommand({ patterns: [command] }, { command }), command).toEqual({ allow: true });
  }
});
