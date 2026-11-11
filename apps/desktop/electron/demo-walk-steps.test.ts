import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { parseRoute } from "../src/nav/route";
import {
  actionScript,
  formatStepFailure,
  pageHasAll,
  stepFileName,
  WALK_STEPS,
  waitForLoad,
} from "./demo-walk-steps";

test("waitForLoad resolves when the page has loaded", async () => {
  const contents = new EventEmitter();
  const result = waitForLoad(contents, 1000);
  contents.emit("did-finish-load");
  await expect(result).resolves.toBeUndefined();
});

test("waitForLoad rejects when the page fails to load", async () => {
  const contents = new EventEmitter();
  const result = waitForLoad(contents, 1000);
  contents.emit("did-fail-load", {}, -1, "failed");
  await expect(result).rejects.toThrow("The page failed to load: failed");
});

test("waitForLoad rejects when the page does not load in time", async () => {
  vi.useFakeTimers();
  try {
    const result = waitForLoad(new EventEmitter(), 1000);
    const assertion = expect(result).rejects.toThrow("The page did not load in time.");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

test("the walk steps have unique names, at least one wait each and routes that exist", () => {
  expect(new Set(WALK_STEPS.map((step) => step.name)).size).toBe(WALK_STEPS.length);
  for (const step of WALK_STEPS) {
    expect(step.waitFor.length).toBeGreaterThan(0);
    if (step.action.kind === "go") expect(parseRoute(step.action.hash).screen).not.toBe("not_found");
  }
  expect(WALK_STEPS.filter((step) => step.shot).length).toBeGreaterThanOrEqual(8);
});

test("actionScript embeds the searched text escaped", () => {
  const name = 'a "quote" \\ </script>';
  expect(actionScript({ kind: "click", role: "button", name })).toContain(JSON.stringify(name));
  for (const action of [
    { kind: "go", hash: "#/runs" },
    { kind: "click", role: "button", name },
    { kind: "click", role: "link", name },
    { kind: "pick", label: name },
    { kind: "firstRun" },
  ] as const)
    expect(actionScript(action).length).toBeGreaterThan(0);
  expect(actionScript({ kind: "pick", label: name })).toContain(JSON.stringify(name));
});

test("pageHasAll needs every text", () => {
  expect(pageHasAll("one two", ["one", "two"])).toBe(true);
  expect(pageHasAll("one", ["one", "two"])).toBe(false);
});

test("stepFileName numbers from 01 and keeps the name", () => {
  expect(stepFileName(0, "sidebar")).toBe("01-sidebar.png");
  expect(stepFileName(11, "second-run")).toBe("12-second-run.png");
});

test("formatStepFailure keeps the step, the URL and 300 characters of the page on one line", () => {
  const body = `first\n${"x".repeat(400)}`;
  expect(formatStepFailure("choice", "app://flowdriven/#/inbox", body)).toBe(
    `walk step choice failed; URL: app://flowdriven/#/inbox; body: ${body.slice(0, 300).replace(/\r?\n/g, " ")}`,
  );
});
