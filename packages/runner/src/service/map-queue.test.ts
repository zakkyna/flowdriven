import { expect, test } from "vitest";
import type { Ticket } from "../keeper/types.ts";
import { toQueueView } from "./map-queue.ts";

const ticket: Ticket = {
  runId: "a",
  stepId: "s",
  itemKey: "",
  kind: "worker",
  harnessId: "claude-code",
  cls: 1,
  underWay: false,
  runStartedAt: "2026-11-11T00:00:00.000Z",
  weightMb: 200,
};
test("maps running, waiting and overlapping runs into the queue", () => {
  const view = toQueueView({
    snapshot: {
      ceiling: 1,
      rows: [
        { ticket, state: "running", queuedMs: 0 },
        {
          ticket: { ...ticket, runId: "b", cls: 2 },
          state: "waiting",
          waiting: { reason: "memory" },
          queuedMs: 3000,
        },
      ],
    },
    ceiling: 1,
    flowName: (id) => `Flow ${id}`,
    stepTitle: () => "Step",
    overlap: [{ runId: "c", startedAt: "2026-11-11T00:00:00.000Z" }],
    nowMs: Date.parse("2026-11-11T00:00:12.000Z"),
  });
  expect(view).toMatchObject({
    running: 1,
    waiting: 2,
    ceiling: 1,
    rows: [
      { runId: "a", class: "owner", state: "running" },
      { runId: "b", class: "triggered", waiting: { reason: "memory" }, queuedSeconds: 3 },
      {
        runId: "c",
        flowName: "Flow c",
        class: "owner",
        state: "waiting",
        waiting: { reason: "flow_overlap" },
        queuedSeconds: 12,
      },
    ],
  });
});
test("a missing snapshot gives zeros", () => {
  expect(
    toQueueView({
      snapshot: undefined,
      ceiling: 4,
      flowName: (id) => id,
      stepTitle: () => undefined,
      overlap: [],
      nowMs: 0,
    }),
  ).toEqual({ running: 0, waiting: 0, ceiling: 4, rows: [] });
});
