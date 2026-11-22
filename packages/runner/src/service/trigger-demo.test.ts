import type { Notice } from "@flowdriven/contracts";
import { expect, test, vi } from "vitest";
import { runTriggerDemo } from "../test-helpers/trigger-demo-run.ts";
import * as serviceFactory from "./service.ts";

test("an hourly trigger fires with no window and a flood is capped", { timeout: 60_000 }, async () => {
  const notices: Notice[] = [];
  const original = serviceFactory.createRunnerService;
  const spy = vi.spyOn(serviceFactory, "createRunnerService").mockImplementation((options) =>
    original({
      ...options,
      notify: (notice) => {
        notices.push(notice);
        options.notify?.(notice);
      },
    }),
  );
  const lines = await runTriggerDemo();
  spy.mockRestore();
  expect(lines[0]).toBe("schedule on: every 1h, next run 2026-11-12T01:00:00.000Z");
  expect(lines[1]).toMatch(/^no window open: 0[12]:00 fired, run-\d+ done$/);
  expect(lines[2]).toMatch(/^no window open: 0[12]:00 fired, run-\d+ done$/);
  expect(lines[3]).toMatch(
    /^slept 5 hours 30 minutes: catch_up once started 1 run for 5 missed fires, run-\d+ done$/,
  );
  expect(lines[4]).toBe(
    "flood: 500 file changes (max_items 1), daily cap 24 -> 24 runs, 476 dropped, 1 notification",
  );
  expect(lines[5]).toBe("notification: [object Object] - [object Object]");
  expect(notices.filter((notice) => notice.kind === "flood_cap")).toEqual([
    expect.objectContaining({
      title: { key: "notice.limitTitle" },
      body: { key: "notice.limitBody" },
      target: { screen: "flow", flowId: "local.flood" },
    }),
  ]);
  expect(lines).toHaveLength(6);
});
