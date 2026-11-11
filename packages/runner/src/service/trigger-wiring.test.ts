import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Notice, RunDetail, RunSummary, TriggerStatus } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { triggerFlow } from "../test-helpers/trigger-rig.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const active: { service: RunnerService; store: Store }[] = [];
afterEach(() => {
  for (const { service, store } of active.splice(0)) {
    service.stop();
    store.close();
  }
  cleanup();
});
const hash = `sha256:${"1".repeat(64)}`;
async function rig(mode: "live" | "demo" = "live", cap = 24, start = true) {
  const dataDir = dirname(tempPath());
  const store = await openSqliteStore(":memory:");
  let time = Date.parse("2026-11-12T00:00:00.000Z");
  let id = 0;
  const jobs: (() => void)[] = [];
  const watchers = new Set<string>();
  const notices: Notice[] = [];
  const service = createRunnerService({
    store,
    dataDir,
    mode,
    now: () => new Date(time),
    newId: (p) => `${p}-${++id}`,
    harness: scriptedHarness({ steps: {} }),
    notify: (notice) => notices.push(notice),
    keeper: { every: () => () => {} },
    triggers: {
      every: (_ms, fn) => {
        jobs.push(fn);
        return () => {
          const i = jobs.indexOf(fn);
          if (i >= 0) jobs.splice(i, 1);
        };
      },
      watch: (path) => {
        watchers.add(path);
        return () => {
          watchers.delete(path);
        };
      },
    },
  });
  active.push({ service, store });
  mkdirSync(join(dataDir, mode === "demo" ? "demo-project" : "project", "inbox"), { recursive: true });
  const manifest = triggerFlow(
    "local.wiring",
    [
      { kind: "manual" },
      { kind: "schedule", every: "1h" },
      { kind: "file_change", path: "inbox" },
      { kind: "new_item", source: "feed", query: "jobs", key: "id", every: "1h" },
    ],
    { limits: { max_runs_per_day: cap } },
  );
  service.engine.registerFlow(manifest, hash);
  if (start) await service.start().settled;
  const call = (name: string, input: unknown) => service.call(name, input);
  const list = async () => TriggerStatus.array().parse(await call("triggers.list", { flowId: manifest.id }));
  const enable = (index: number, enabled = true, value = hash) =>
    call("triggers.setEnabled", { flowId: manifest.id, index, enabled, hash: value });
  const advance = async () => {
    time += 3_600_000;
    jobs.at(0)?.();
    await flush();
  };
  return { service, store, manifest, call, list, enable, advance, jobs, watchers, notices };
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

test("triggers.list shows each non-manual trigger of a flow with its state, its reason and its next run", async () => {
  const r = await rig();
  expect(await r.list()).toMatchObject([
    { index: 1, kind: "schedule", state: "off" },
    { index: 2, kind: "file_change", state: "off" },
    { index: 3, kind: "new_item", state: "unavailable", reason: "Not available yet." },
  ]);
  await r.enable(1);
  expect((await r.list()).at(0)).toMatchObject({ state: "on", nextAt: "2026-11-12T01:00:00.000Z" });
});
test("triggers.setEnabled switches on with the current hash, refuses a stale hash with not_allowed, refuses new_item as not available yet, and switches off", async () => {
  const r = await rig();
  await expect(r.enable(1, true, `sha256:${"2".repeat(64)}`)).rejects.toMatchObject({ code: "not_allowed" });
  await expect(r.enable(3)).rejects.toMatchObject({ code: "not_allowed", message: "Not available yet." });
  expect(await r.enable(1)).toMatchObject({ state: "on" });
  expect(await r.enable(1, false)).toMatchObject({ state: "off" });
});
test("in demo mode triggers.list works and setEnabled(true) is not_allowed; switching off is allowed", async () => {
  const r = await rig("demo");
  expect(await r.list()).toHaveLength(3);
  await expect(r.enable(1)).rejects.toMatchObject({
    code: "not_allowed",
    message: "Triggers stay off in the demo.",
  });
  expect(await r.enable(1, false)).toMatchObject({ state: "off" });
});
test("an unknown flow and an index that does not exist are not_found; a malformed hash is invalid_input", async () => {
  const r = await rig();
  await expect(r.call("triggers.list", { flowId: "local.missing" })).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(r.enable(99)).rejects.toMatchObject({ code: "not_found" });
  await expect(r.enable(1, true, "abc")).rejects.toMatchObject({ code: "invalid_input" });
});
test("a fire appears in runs.list with its trigger in words, a run the owner starts has no trigger field, and runs.status carries the words too", async () => {
  const r = await rig();
  await r.enable(1);
  await r.advance();
  const triggered = RunSummary.array()
    .parse(await r.call("runs.list", {}))
    .at(0);
  expect(triggered?.trigger).toEqual({ kind: "schedule", words: "Started by its schedule" });
  if (!triggered) throw new Error("Missing triggered run");
  expect(RunDetail.parse(await r.call("runs.status", { runId: triggered.id })).trigger).toEqual(
    triggered.trigger,
  );
  const manual = RunSummary.parse(await r.call("flows.run", { flowId: r.manifest.id }));
  expect(manual.trigger).toBeUndefined();
  expect(
    RunSummary.array()
      .parse(await r.call("runs.list", {}))
      .find((run) => run.id === manual.id)?.trigger,
  ).toBeUndefined();
});
test("a fired run that ends blocked sends one blocked notice through notify, and a flood sends one flood notice", async () => {
  const r = await rig("live", 1);
  await r.enable(1);
  await r.advance();
  await r.advance();
  expect(r.store.listRuns({ flowId: r.manifest.id })).toMatchObject([{ state: "blocked" }]);
  expect(r.notices.map((n) => n.kind)).toEqual(["run_blocked", "flood_cap"]);
});
test("start() starts the repeating job once and ticks at once; stop() cancels it and closes the watchers; demo mode never starts it", async () => {
  const r = await rig("live", 24, false);
  expect(r.jobs).toHaveLength(0);
  await r.enable(2);
  await r.service.start().settled;
  await r.service.start().settled;
  await flush();
  expect(r.jobs).toHaveLength(1);
  expect(r.watchers.size).toBe(1);
  r.service.stop();
  expect(r.jobs).toHaveLength(0);
  expect(r.watchers.size).toBe(0);
  const demo = await rig("demo");
  expect(demo.jobs).toHaveLength(0);
});
test("the audit log holds trigger_enabled with the flow id, the index and the hash and no payload text", async () => {
  const r = await rig();
  await r.enable(1);
  const audit = r.store.listAudit().find((entry) => entry.kind === "trigger_enabled");
  expect(audit?.detail).toMatchObject({ flowId: r.manifest.id, index: 1, hash });
  expect(JSON.stringify(audit?.detail)).not.toContain("payload");
});
