import type { Notice } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createFakeNoticeSink } from "./notice-sink.ts";

test("fake notice sink records every notice in order", () => {
  const sink = createFakeNoticeSink();
  const first: Notice = {
    id: "one",
    kind: "approval_waiting",
    title: "Decision",
    body: "Open app",
    target: { screen: "inbox" },
  };
  const second: Notice = {
    ...first,
    id: "two",
    kind: "run_blocked",
    target: { screen: "run", runId: "run-1" },
  };
  expect(sink.notices).toEqual([]);
  sink.send(first);
  sink.send(second);
  expect(sink.notices).toEqual([first, second]);
});
