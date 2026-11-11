import { expect, test } from "vitest";
import { runTriggerDemo } from "../test-helpers/trigger-demo-run.ts";

test("an hourly trigger fires with no window and a flood is capped", { timeout: 60_000 }, async () => {
  const lines = await runTriggerDemo();
  expect(lines[0]).toBe("schedule on: every 1h, next run 2026-11-12T01:00:00.000Z");
  expect(lines[1]).toMatch(/^no window open: 0[12]:00 fired, run-\d+ done$/);
  expect(lines[2]).toMatch(/^no window open: 0[12]:00 fired, run-\d+ done$/);
  expect(lines[3]).toMatch(
    /^slept 5 hours 30 minutes: catch_up once started 1 run for 5 missed fires, run-\d+ done$/,
  );
  expect(lines[4]).toBe("flood: 500 file changes, daily cap 24 -> 24 runs, 476 dropped, 1 notification");
  expect(lines[5]).toBe(
    "notification: Too many runs - Flood flow reached its limit of 24 runs today. More fires are dropped until tomorrow.",
  );
  expect(lines).toHaveLength(6);
});
