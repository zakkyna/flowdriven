import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, validateManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { digestCall } from "../connectors/grants.ts";
import { createEngine } from "../engine.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const dirs: string[] = [];
const stores: Store[] = [];
const services: RunnerService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const now = () => new Date("2026-11-12T00:00:00Z");
const input = { id: "d1" };
const hold = {
  requirementId: "gmail",
  tool: "delete_draft",
  input,
  digest: digestCall("delete_draft", input),
  action: "delete" as const,
};
function manifest(steps: unknown[], triggers?: unknown[]) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.proof-service",
    name: "Proof",
    kind: "build",
    requirements: [
      { id: "gmail", type: "mcp_server", ref: "connector:gmail", tools: ["search_threads", "delete_draft"] },
    ],
    steps,
    ...(triggers ? { triggers } : {}),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
const worker = {
  id: "work",
  do: "worker",
  instructions: "Work",
  uses: ["gmail"],
  checks: [{ type: "contains", pattern: "ok" }],
};
async function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  dirs.push(dir);
  const store = await openSqliteStore(":memory:", { now });
  stores.push(store);
  let n = 0;
  const harness = scriptedHarness({
    steps: {
      work: [{ hold }, { text: "ok" }],
      find: { text: "ok", outputs: { jobs: [{ id: "j1", title: "Job" }], message: "ok" } },
    },
  });
  const service = createRunnerService({
    store,
    dataDir: dir,
    mode: "demo",
    harness,
    now,
    newId: (p) => `${p}-${++n}`,
  });
  services.push(service);
  await service.start().settled;
  return { store, service, harness, dir };
}
function pending(store: Store) {
  const a = store.listApprovals({ state: "pending" }).at(0);
  if (!a) throw new Error("Missing approval");
  return a;
}
test("approvals.resolve approves and rejects a held call through the handler, refuses edit and applyToSimilar with their present sentences, and an ask is still told to pick", async () => {
  for (const decision of ["approve", "reject"] as const) {
    const c = await setup();
    const m = manifest([worker]);
    c.service.engine.registerFlow(m, `sha256:${"0".repeat(64)}`);
    const run = await c.service.engine.startRun(m.id, { project: c.dir });
    expect(run.state).toBe("waiting_approval");
    const a = pending(c.store);
    await expect(
      c.service.call("approvals.resolve", { approvalId: a.id, decision: "edit", editedText: "x" }),
    ).rejects.toMatchObject({ code: "invalid_input", message: "Only text can be edited." });
    await expect(
      c.service.call("approvals.resolve", { approvalId: a.id, decision: "approve", applyToSimilar: true }),
    ).rejects.toMatchObject({ code: "not_allowed", message: "Nothing here can be approved as a batch." });
    await c.service.call("approvals.resolve", { approvalId: a.id, decision });
    expect(c.store.getApproval(a.id)?.state).toBe(decision === "approve" ? "approved" : "rejected");
    if (decision === "reject") expect(c.store.getRun(run.id)?.state).toBe("failed");
  }
  const c = await setup();
  const m = manifest([
    {
      id: "find",
      do: "worker",
      instructions: "Find",
      outputs: [
        { id: "jobs", type: "json" },
        { id: "message", type: "text" },
      ],
      checks: [{ type: "contains", pattern: "ok" }],
    },
    {
      id: "pick",
      do: "ask",
      ask: { question: "Pick", choose_from: "${steps.find.outputs.jobs}", max_pick: 1 },
    },
  ]);
  c.service.engine.registerFlow(m, `sha256:${"0".repeat(64)}`);
  await c.service.engine.startRun(m.id, { project: c.dir });
  await expect(
    c.service.call("approvals.resolve", { approvalId: pending(c.store).id, decision: "approve" }),
  ).rejects.toMatchObject({ code: "invalid_input", message: "This is a choice. Pick from its options." });
});
test("R4: the walk's flow shape (a Gmail requirement with search_threads and delete_draft and a worker step that uses it before any ask) has no issue as a manual flow and an unattended_prefix error with a schedule trigger", () => {
  const manual = manifest([worker]);
  expect(validateManifest(manual)).toEqual([]);
  const scheduled = manifest([worker], [{ kind: "schedule", every: "1h" }]);
  expect(validateManifest(scheduled)).toContainEqual(
    expect.objectContaining({ code: "unattended_prefix", severity: "error" }),
  );
});
test("a held run survives the end of the process's engine: a new engine on the same store leaves the run waiting_approval after recoverAfterCrash and the approval can still be approved", async () => {
  const c = await setup();
  const m = manifest([worker]);
  c.service.engine.registerFlow(m, `sha256:${"0".repeat(64)}`);
  const run = await c.service.engine.startRun(m.id, { project: c.dir });
  const a = pending(c.store);
  c.service.engine.shutdown();
  const engine = createEngine({
    store: c.store,
    harness: scriptedHarness({ steps: { work: { text: "ok" } } }),
    now,
    newId: (p) => `${p}-new`,
  });
  expect(await engine.recoverAfterCrash()).toEqual([]);
  expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  expect(c.store.getApproval(a.id)?.state).toBe("pending");
  expect((await engine.decide(a.id, "approve")).state).toBe("done");
});
