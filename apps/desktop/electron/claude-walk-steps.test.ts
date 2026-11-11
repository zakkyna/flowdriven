import { expect, test } from "vitest";
import { parseRoute } from "../src/nav/route";
import { CLAUDE_WALK_STEPS, claudeActionScript, walkPaths } from "./claude-walk-steps";
import { actionScript } from "./demo-walk-steps";

test("the steps have unique names, a wait each, routes that exist, and the last step waits for Blocked calls", () => {
  expect(new Set(CLAUDE_WALK_STEPS.map((s) => s.name)).size).toBe(CLAUDE_WALK_STEPS.length);
  for (const step of CLAUDE_WALK_STEPS) {
    expect(step.waitFor.length).toBeGreaterThan(0);
    if (step.action.kind === "go") expect(parseRoute(step.action.hash).screen).not.toBe("not_found");
  }
  expect(CLAUDE_WALK_STEPS.at(-1)).toMatchObject({
    name: "run-done",
    shot: true,
    timeoutMs: 240000,
    waitFor: expect.arrayContaining(["Blocked calls"]),
  });
});
test("claudeActionScript embeds the name escaped, aims at the dialog and leaves the other actions to actionScript", () => {
  const name = 'a "quote" \\ </script>';
  const script = claudeActionScript({ kind: "clickInDialog", name });
  expect(script).toContain(JSON.stringify(name));
  expect(script).toContain('[role="dialog"]');
  const action = { kind: "go", hash: "#/runs" } as const;
  expect(claudeActionScript(action)).toBe(actionScript(action));
  expect(claudeActionScript({ kind: "wait" })).toBe("true");
});
test("the live steps have a long timeout and the others none", () => {
  expect(CLAUDE_WALK_STEPS.filter((s) => s.timeoutMs !== undefined).map((s) => s.name)).toEqual([
    "run-now",
    "run-done",
  ]);
  for (const step of CLAUDE_WALK_STEPS.filter((s) => s.timeoutMs !== undefined))
    expect(step.timeoutMs).toBeGreaterThanOrEqual(120000);
});
test("walkPaths puts the data folder under a name with a space and finds the check flow", () => {
  const paths = walkPaths("/repo");
  expect(paths.dataDir.endsWith("claude-walk/app data")).toBe(true);
  expect(paths.flowDir.endsWith("packages/runner/src/claude/check-flow")).toBe(true);
});

test("the run action opens the detail and waits for completion", () => {
  expect(CLAUDE_WALK_STEPS.slice(-2)).toEqual([
    {
      name: "run-now",
      action: { kind: "click", role: "button", name: "Run now" },
      waitFor: ["All runs", "Write the note", "Read the note", "Try a forbidden read"],
      shot: false,
      timeoutMs: 120000,
    },
    {
      name: "run-done",
      action: { kind: "wait" },
      waitFor: [
        "Done",
        "3 of 3 steps passed",
        "Blocked calls",
        "This path is outside the folders this step declares.",
      ],
      shot: true,
      timeoutMs: 240000,
    },
  ]);
});
