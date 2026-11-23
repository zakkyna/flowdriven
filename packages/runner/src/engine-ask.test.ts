import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
async function ready(
  options: {
    maxPick?: number | string;
    daily?: number;
    allFit?: boolean;
    empty?: boolean;
    expiry?: string;
    source?: string;
    signoff?: boolean;
    jobs?: { id: string; title: string }[];
    question?: string;
  } = {},
) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.ask",
    name: "Ask",
    kind: "build",
    params: {
      who: { type: "text", default: "Ana" },
      daily_builds: { type: "number", default: options.daily ?? 2 },
    },
    requirements: [{ id: "host", type: "mcp_server", tools: ["publish"] }],
    steps: [
      {
        id: "alerts",
        do: "worker",
        instructions: "Find jobs",
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "j1" }],
      },
      {
        id: "review",
        for_each: "${steps.alerts.outputs.jobs}",
        as: "job",
        key: "${job.id}",
        steps: [
          {
            id: "full",
            do: "agent",
            instructions: "Review ${job}",
            outputs: [
              { id: "verdict", type: "json" },
              { id: "message", type: "text" },
            ],
            checks: [{ type: "contains", pattern: "ok" }],
          },
        ],
      },
      {
        id: "pick",
        do: "ask",
        ask: {
          question: options.question ?? "Pick for ${params.who}",
          choose_from: options.source ?? "${steps.review.items where steps.full.outputs.verdict.fit}",
          max_pick: options.maxPick ?? 1,
          approves: ["host.publish"],
          ...(options.expiry ? { on_expiry: options.expiry } : {}),
        },
      },
      {
        id: "build",
        for_each: "${steps.pick.outputs.choice}",
        as: "job",
        key: "${job.id}",
        steps: [
          {
            id: "proto",
            ...(options.signoff ? { title: "Approve the build plan for ${job.id}" } : {}),
            do: "worker",
            instructions: "Build ${job}",
            ...(options.signoff ? { outputs: [{ id: "plan", type: "text" }] } : {}),
            checks: options.signoff
              ? [{ type: "user", own_text: true }]
              : [{ type: "files", paths: ["out.txt"], min_count: 1 }],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const project = mkdtempSync(join(tmpdir(), "flowdriven-"));
  folders.push(project);
  writeFileSync(join(project, "out.txt"), "ok");
  const jobs =
    options.jobs ?? ["one", "two", "three"].map((title, i) => ({ id: `j${i + 1}`, title: `Job ${title}` }));
  let duringProto: (() => void) | undefined;
  const c = await setup(parsed.manifest, {
    steps: {
      alerts: { text: "j1", outputs: { jobs, message: "ok" } },
      full: (req) => ({
        text: "ok",
        outputs: {
          verdict: { fit: !options.empty && (options.allFit || req.itemKey !== "j2") },
          message: "ok",
        },
      }),
      proto: () => {
        duringProto?.();
        return options.signoff ? { outputs: { plan: "Plan text" } } : {};
      },
    },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project });
  return {
    ...c,
    run,
    onProto(fn: () => void) {
      duringProto = fn;
    },
  };
}
function approval(c: Awaited<ReturnType<typeof ready>>) {
  const ap = c.engine.listApprovals({ state: "pending" }).at(0);
  if (!ap) throw new Error("missing approval");
  return ap;
}
test("creates a choice, holds the run in waiting_approval and lists it", async () => {
  const c = await ready();
  expect(c.run.state).toBe("waiting_approval");
  const ap = approval(c);
  expect(ap).toMatchObject({
    kind: "ask",
    stepId: "pick",
    summary: "Pick for Ana",
    maxPick: 1,
    createdAt: "2026-11-11T09:00:00.000Z",
    expiresAt: "2026-11-12T09:00:00.000Z",
  });
  const payload = ap.payload as { options: { key: string; label: string }[] };
  expect(payload.options.map((o) => [o.key, o.label])).toEqual([
    ["j1", "Job one"],
    ["j3", "Job three"],
  ]);
});
test("an answer picks among the options and feeds the next loop", async () => {
  const c = await ready();
  const after = await c.engine.answerAsk(approval(c).id, { picks: ["j3"] });
  expect(c.harness.calls.filter((x) => x.stepId === "proto").map((x) => x.itemKey)).toEqual(["j3"]);
  expect(after.state).toBe("done");
});
test("TC-j24-26 a choice enforces its maximum and runs only the chosen items", async () => {
  const c = await ready({ maxPick: 2, allFit: true });
  const ap = approval(c);
  await expect(c.engine.answerAsk(ap.id, { picks: ["j1", "j2", "j3"] })).rejects.toMatchObject({
    code: "invalid_input",
    reason: "too_many_picks",
    params: { max: 2 },
  });
  expect(c.store.getApproval(ap.id)?.state).toBe("pending");
  expect((await c.engine.answerAsk(ap.id, { picks: ["j1", "j2"] })).state).toBe("done");
  expect(c.harness.calls.filter((x) => x.stepId === "proto").map((x) => x.itemKey)).toEqual(["j1", "j2"]);
});
test("TC-j24-27 picking none skips the dependent loop with its reason", async () => {
  const c = await ready();
  const ap = approval(c);
  expect((await c.engine.answerAsk(ap.id, { picks: [] })).state).toBe("done");
  expect(c.store.getApproval(ap.id)).toMatchObject({ state: "approved", picks: [] });
  expect(c.store.getStep(c.run.id, "build")).toMatchObject({
    state: "skipped",
    skipped: { because: "no_picks" },
  });
  expect(c.harness.calls.filter((x) => x.stepId === "proto")).toEqual([]);
});
test("TC-j24-28 picked jobs ask for own-text sign-off one at a time", async () => {
  const c = await ready({ maxPick: 2, allFit: true, signoff: true });
  await c.engine.answerAsk(approval(c).id, { picks: ["j1", "j2"] });
  let pending = c.store.listApprovals({ runId: c.run.id, state: "pending" });
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ kind: "result_sign_off", itemKey: "j1", payload: "Plan text" });
  expect(pending[0]?.summary).toContain("run commands on your Mac");
  expect(pending[0]?.summary).toContain("Approve the build plan for j1");
  const first = pending[0];
  if (!first) throw new Error("missing sign-off");
  await c.engine.decide(first.id, "approve");
  pending = c.store.listApprovals({ runId: c.run.id, state: "pending" });
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ kind: "result_sign_off", itemKey: "j2", payload: "Plan text" });
  expect(pending[0]?.summary).toContain("Approve the build plan for j2");
});
test("TC-RUL-21 refuses picks outside the options and a second answer", async () => {
  const c = await ready();
  const ap = approval(c);
  await expect(c.engine.answerAsk(ap.id, { picks: ["j2"] })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(c.engine.answerAsk(ap.id, { picks: ["j1", "j3"] })).rejects.toMatchObject({
    code: "invalid_input",
  });
  await expect(c.engine.answerAsk(ap.id, { picks: ["j1", "j1"] })).rejects.toMatchObject({
    code: "invalid_input",
  });
  const both = await Promise.allSettled([
    c.engine.answerAsk(ap.id, { picks: ["j1"] }),
    c.engine.answerAsk(ap.id, { picks: ["j1"] }),
  ]);
  expect(both.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect((both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({
    code: "conflict",
    reason: "already_answered",
    params: { via: "window" },
    message: "This decision was already made.",
  });
  expect(c.harness.calls.filter((x) => x.stepId === "proto").length).toBe(1);
  await expect(c.engine.decide(ap.id, "approve")).rejects.toMatchObject({ code: "invalid_input" });
});
test("max_pick from a param", async () => {
  const c = await ready({ maxPick: "${params.daily_builds}", allFit: true });
  const ap = approval(c);
  await expect(c.engine.answerAsk(ap.id, { picks: ["j1", "j2", "j3"] })).rejects.toMatchObject({
    code: "invalid_input",
  });
  expect((await c.engine.answerAsk(ap.id, { picks: ["j1", "j3"] })).state).toBe("done");
});
test("a max_pick that is not a whole number blocks the run", async () => {
  const c = await ready({ maxPick: "${params.daily_builds}", daily: 1.5 });
  expect(c.run).toMatchObject({ state: "blocked", blockedReason: expect.stringContaining("max_pick") });
  expect(c.engine.listApprovals()).toEqual([]);
});
test("TC-j24-31 choices wait beyond 25 hours for both expiry modes", async () => {
  for (const expiry of ["end", "fail"]) {
    const c = await ready({ expiry });
    const ap = approval(c);
    c.clock.advance(25 * 3_600_000);
    const view = c.engine.getRun(c.run.id);
    expect(view.run.state).toBe("waiting_approval");
    expect(view.approvals.at(0)?.state).toBe("pending");
    expect(view.steps.find((s) => s.stepId === "pick")?.state).toBe("waiting_approval");
    expect(view.steps.find((s) => s.stepId === "build")).toBeUndefined();
    expect((await c.engine.answerAsk(ap.id, { picks: ["j1"] })).state).toBe("done");
    expect(c.harness.calls.filter((x) => x.stepId === "proto").map((x) => x.itemKey)).toEqual(["j1"]);
  }
});
test("ask.approves grants only the picked items, only in this run", async () => {
  const c = await ready();
  const during: boolean[] = [];
  c.onProto(() => {
    during.push(
      c.engine.isApproved(c.run.id, "host.publish", "j1"),
      c.engine.isApproved(c.run.id, "host.publish", "j3"),
      c.engine.isApproved("run-2", "host.publish", "j1"),
      c.engine.isApproved(c.run.id, "host.delete", "j1"),
    );
  });
  await c.engine.answerAsk(approval(c).id, { picks: ["j1"] });
  // While the picked item's step runs, only the named tool is released, and only for that item.
  expect(during).toEqual([true, false, false, false]);
  // Once the run has ended nothing stays released: the grant expires with the run.
  expect(c.engine.isApproved(c.run.id, "host.publish", "j1")).toBe(false);
  expect(c.engine.isApproved(c.run.id, "host.publish", "j3")).toBe(false);
  expect(c.engine.isApproved("run-2", "host.publish", "j1")).toBe(false);
  expect(c.engine.isApproved(c.run.id, "host.delete", "j1")).toBe(false);
});
test("refuses to answer when the run is no longer waiting", async () => {
  const c = await ready();
  const ap = approval(c);
  c.store.updateRun(c.run.id, { state: "failed" });
  await expect(c.engine.answerAsk(ap.id, { picks: ["j1"] })).rejects.toMatchObject({
    code: "not_allowed",
    message: "This run is no longer waiting for approval.",
  });
});
test("an empty list of options passes the ask with no approval", async () => {
  const c = await ready({ empty: true });
  expect(c.engine.listApprovals()).toEqual([]);
  expect(c.store.getStep(c.run.id, "pick")).toMatchObject({ state: "passed", outputs: { choice: [] } });
});
test("a choice source that is not a list blocks the run", async () => {
  const c = await ready({ source: "${params.who}" });
  expect(c.run.state).toBe("blocked");
  expect(c.engine.listApprovals()).toEqual([]);
});

test.each([
  [51, 4, "blocked"],
  [50, 4, "waiting_approval"],
  [1, 4001, "blocked"],
  [1, 4000, "waiting_approval"],
] as const)("T17 choice bounds count %i title %i", async (count, length, state) => {
  const jobs = Array.from({ length: count }, (_, i) => ({ id: `j${i + 1}`, title: "x".repeat(length) }));
  const c = await ready({ jobs, allFit: true });
  expect(c.run.state).toBe(state);
  if (state === "blocked") {
    expect(c.store.getStep(c.run.id, "pick")?.note).toBe("The choices are too many or too long to show.");
    expect(c.engine.listApprovals()).toEqual([]);
  }
});
test("T17 long choice question keeps full payload and bounded summary", async () => {
  const question = "q".repeat(300);
  const c = await ready({ question });
  expect(approval(c).summary.length).toBeLessThanOrEqual(200);
  expect(approval(c).payload).toMatchObject({ question });
});
