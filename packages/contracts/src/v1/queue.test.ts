import { expect, test } from "vitest";
import { HarnessCard, operations, QueueView, UsageSummary } from "./index.ts";

const sampleCard = () => ({
  id: "claude-code",
  name: "Claude Code",
  binary: "claude",
  detected: true,
  login: "logged_in",
  risk: "gray",
  vendorProhibited: false,
  consent: "given",
  sandbox: "none",
  adapter: "full",
  quota: { state: "unknown", today: { calls: 0 }, week: { calls: 0 } },
  inventory: { supported: true, skills: [], plugins: [], mcpServers: [] },
});

test("the queue and usage operations exist and are app only", () => {
  for (const name of ["queue.list", "queue.move", "usage.summary"] as const)
    expect(operations[name].mcp).toBe("no");
  expect(operations["queue.move"].input.safeParse({ runId: "r" }).success).toBe(true);
  expect(operations["queue.move"].input.safeParse({}).success).toBe(false);
});
test("a queue view counts running and waiting steps and gives each waiting row its reason", () => {
  const view = QueueView.parse({
    running: 1,
    waiting: 1,
    ceiling: 1,
    rows: [
      { runId: "a", flowName: "A", class: "owner", state: "running", queuedSeconds: 0 },
      {
        runId: "b",
        flowName: "B",
        class: "owner",
        state: "waiting",
        queuedSeconds: 3,
        waiting: { reason: "ceiling", running: 1, ceiling: 1 },
      },
    ],
  });
  expect(view.rows.at(1)?.waiting?.reason).toBe("ceiling");
  expect(QueueView.safeParse({ ...view, ceiling: 0 }).success).toBe(false);
});
test("a harness card may list the windows the harness reported", () => {
  const card = {
    ...sampleCard(),
    quota: {
      state: "available",
      today: { calls: 0 },
      week: { calls: 0 },
      windows: [{ name: "seven_day", utilization: 0.78, resetsAt: "2026-11-14T17:59:00.000Z" }],
    },
  };
  expect(HarnessCard.parse(card).quota.windows?.at(0)?.name).toBe("seven_day");
  expect(
    HarnessCard.safeParse({
      ...card,
      quota: { ...card.quota, windows: [{ name: "seven_day", utilization: 1.5 }] },
    }).success,
  ).toBe(false);
});
test("a usage summary has day and week totals and a limit state per harness", () => {
  const totals = { calls: 2, input: 8, output: 768, cacheRead: 16908, cacheWrite: 312 };
  expect(
    UsageSummary.parse({
      harnesses: [
        {
          harnessId: "claude-code",
          name: "Claude Code",
          today: totals,
          week: totals,
          limit: { status: "warning", sevenDay: { utilization: 0.78 } },
        },
      ],
    }).harnesses,
  ).toHaveLength(1);
});
