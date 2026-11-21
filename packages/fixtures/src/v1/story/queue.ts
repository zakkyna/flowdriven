import type { QueueView, UsageSummary } from "@flowdriven/contracts/v1";

export function queue(): QueueView {
  return {
    running: 1,
    waiting: 2,
    ceiling: 1,
    rows: [
      { runId: "run-0007", flowName: "Email triage", class: "owner", state: "running", queuedSeconds: 0 },
      {
        runId: "run-0006",
        flowName: "Figma to Flutter",
        class: "owner",
        state: "waiting",
        queuedSeconds: 3,
        waiting: { reason: "ceiling", running: 1, ceiling: 1 },
      },
      {
        runId: "run-0005",
        flowName: "Documents and reports",
        class: "triggered",
        state: "waiting",
        queuedSeconds: 5,
        harnessId: "claude-code",
        waiting: { reason: "quota", harnessId: "claude-code", until: "2026-11-11T14:05:00.000Z" },
      },
    ],
  };
}
export function usage(): UsageSummary {
  return {
    harnesses: [
      {
        harnessId: "claude-code",
        name: "Claude Code",
        today: { calls: 2, input: 8, output: 768, cacheRead: 16908, cacheWrite: 312 },
        week: { calls: 2, input: 8, output: 768, cacheRead: 16908, cacheWrite: 312 },
        limit: { status: "warning", sevenDay: { utilization: 0.78 } },
      },
    ],
  };
}
