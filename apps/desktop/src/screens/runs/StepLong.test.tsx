import type { StepRun } from "@flowdriven/contracts";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StepBlock } from "./StepBlock";

const step: StepRun = {
  stepId: "build",
  title: "Build",
  do: "worker",
  state: "running",
  maxAttempts: 1,
  checks: [],
  attempts: [
    { number: 1, startedAt: "2026-11-17T00:00:00.000Z" },
    { number: 2, startedAt: "2026-11-17T01:18:00.000Z" },
  ],
  limitMs: 150 * 60_000,
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a step with a limit shows Time limit: 150 min", () => {
  render(<StepBlock step={{ ...step, state: "passed" }} index={1} />);
  expect(screen.getByText("Time limit: 150 min")).toBeTruthy();
  expect(screen.queryByText(/Running for/)).toBeNull();
});

test("a running long step shows Running for 42 min of at most 150 min, with an icon and words", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T02:00:00.000Z"));
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const { rerender } = render(<StepBlock step={step} index={1} />);
  const line = screen.getByText("Running for 42 min of at most 150 min");
  expect(line.parentElement?.querySelector("svg")).not.toBeNull();
  expect(screen.getByText("Your Mac stays awake until this step ends.")).toBeTruthy();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  rerender(<StepBlock step={step} index={1} />);
  expect(screen.queryByText("Your Mac stays awake until this step ends.")).toBeNull();
});

test("a running step of 30 minutes or less shows no running time and no awake line", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const { rerender } = render(<StepBlock step={{ ...step, limitMs: 30 * 60_000 }} index={1} />);
  expect(screen.getByText("Time limit: 30 min")).toBeTruthy();
  expect(screen.queryByText(/Running for/)).toBeNull();
  expect(screen.queryByText(/Your Mac stays awake/)).toBeNull();
  rerender(<StepBlock step={{ ...step, limitMs: undefined }} index={1} />);
  expect(screen.queryByText(/Time limit:/)).toBeNull();
});
