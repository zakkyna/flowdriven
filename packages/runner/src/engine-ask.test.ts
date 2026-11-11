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
          question: "Pick for ${params.who}",
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
            do: "worker",
            instructions: "Build ${job}",
            checks: [{ type: "files", paths: ["out.txt"], min_count: 1 }],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const project = mkdtempSync(join(tmpdir(), "flowdriven-"));
  folders.push(project);
  writeFileSync(join(project, "out.txt"), "ok");
  const jobs = ["one", "two", "three"].map((title, i) => ({ id: `j${i + 1}`, title: `Job ${title}` }));
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
      proto: {},
    },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project });
  return { ...c, run };
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
test("refuses picks outside the options and a second answer", async () => {
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
    code: "not_allowed",
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
test("expiry applies on every read", async () => {
  const c = await ready();
  const ap = approval(c);
  c.clock.advance(24 * 3_600_000 + 1);
  const view = c.engine.getRun(c.run.id);
  expect(view.run.state).toBe("done");
  expect(view.approvals.at(0)?.state).toBe("expired");
  expect(view.steps.find((s) => s.stepId === "pick")).toMatchObject({
    state: "passed",
    outputs: { choice: [] },
  });
  expect(view.steps.find((s) => s.stepId === "build")?.state).toBe("skipped");
  await expect(c.engine.answerAsk(ap.id, { picks: ["j1"] })).rejects.toMatchObject({
    code: "not_allowed",
    message: "This approval expired.",
  });
  const d = await ready({ expiry: "fail" });
  d.clock.advance(24 * 3_600_000 + 1);
  expect(d.engine.listRuns().at(0)?.state).toBe("failed");
  expect(d.store.getStep(d.run.id, "pick")?.note).toBe("The approval expired.");
  expect(d.engine.listApprovals().at(0)?.state).toBe("expired");
});
test("ask.approves grants only the picked items, only in this run", async () => {
  const c = await ready();
  await c.engine.answerAsk(approval(c).id, { picks: ["j1"] });
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
