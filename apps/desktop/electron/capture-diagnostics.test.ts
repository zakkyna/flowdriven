import { expect, test } from "vitest";
import { formatConsoleErrors, formatNotReady, recordConsoleError } from "./capture-diagnostics";

test("not-ready diagnostic includes screen, URL and at most 300 characters on one line", () => {
  expect(formatNotReady("builder", "app://flowdriven/#/builder", `hello\n${"x".repeat(300)}`)).toBe(
    `screen builder never became ready; URL: app://flowdriven/#/builder; body: hello ${"x".repeat(294)}`,
  );
});

test("collects only renderer errors with their screen name", () => {
  const errors: { screen: string; message: string }[] = [];
  recordConsoleError(errors, "builder-light", { level: "warning", message: "ignore" });
  recordConsoleError(errors, "builder-light", { level: "error", message: "broken" });
  recordConsoleError(errors, "runs-dark", { level: "error", message: "other" });
  expect(formatConsoleErrors(errors)).toEqual([
    "screen builder-light console error: broken",
    "screen runs-dark console error: other",
  ]);
});
