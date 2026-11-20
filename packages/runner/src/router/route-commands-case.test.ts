import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { decideCommand } from "../claude/commands.ts";
import { routeRequirement } from "./route.ts";

const route = (command: string) =>
  routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [command] }), {
    hooks: true,
    chrome: false,
  });

test("a program word in capital letters (SH, Codex, Claude, NODE, Git) drops the route and is refused at the hook like its lower-case name", () => {
  for (const [upper, lower] of [
    ["SH -c x", "sh -c x"],
    ["Codex exec x", "codex exec x"],
    ["Claude prompt", "claude prompt"],
    ["NODE *", "node *"],
    ["Git fetch x", "git fetch x"],
    ["PYTHON3.13 *", "python3.13 *"],
    ["Rscript *", "rscript *"],
    ["DD x", "dd x"],
    ["Find x -delete", "find x -delete"],
  ] as const) {
    const lowerRoute = route(lower);
    if (!lowerRoute || lowerRoute.routed) throw new Error(`Expected a refusal for ${lower}`);
    expect(route(upper), upper).toMatchObject({ routed: false, reason: lowerRoute.reason });
    if (!upper.includes("*"))
      expect(decideCommand({ patterns: [upper] }, { command: upper }), upper).toEqual(
        decideCommand({ patterns: [lower] }, { command: lower }),
      );
  }
  expect(decideCommand({ patterns: ["flutter test"] }, { command: "Flutter test" }).allow).toBe(false);
});
