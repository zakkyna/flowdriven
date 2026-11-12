import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { Routed } from "./router/types.ts";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const first: Routed[] = [{ routed: false, requirementId: "a", type: "web", noun: "Web", reason: "first" }];
const second: Routed[] = [{ routed: false, requirementId: "a", type: "web", noun: "Web", reason: "second" }];
const parsed = parseManifest({
  format: "flowdriven-flow/1.1",
  id: "local.test",
  name: "Test",
  kind: "build",
  steps: [{ id: "a", do: "worker", instructions: "Work", checks: [{ type: "contains", pattern: "ok" }] }],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const manifest = parsed.manifest;
test("with routeOf, a run stores the routes it was started with, and a second start after routeOf changed stores the new ones while the first run keeps its own", async () => {
  let routes = first;
  const c = await setup(manifest, { steps: { a: { text: "ok" } } }, { routeOf: () => routes });
  stores.push(c.store);
  const a = await c.engine.startRun(manifest.id, { project: "/tmp" });
  routes = second;
  const b = await c.engine.startRun(manifest.id, { project: "/tmp" });
  expect(c.store.getRun(a.id)?.routes).toEqual(first);
  expect(c.store.getRun(b.id)?.routes).toEqual(second);
});
test("a resumed run keeps its stored routes and does not call routeOf", async () => {
  let blocked = true;
  const routeOf = vi.fn(() => first);
  const c = await setup(
    manifest,
    { steps: { a: () => (blocked ? { exit: "quota" } : { text: "ok" }) } },
    { routeOf },
  );
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: "/tmp" });
  blocked = false;
  await c.engine.resumeRun(run.id);
  expect(routeOf).toHaveBeenCalledTimes(1);
  expect(c.store.getRun(run.id)?.routes).toEqual(first);
});
test("without routeOf no routes are stored", async () => {
  const c = await setup(manifest, { steps: { a: { text: "ok" } } });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: "/tmp" });
  expect(c.store.getRun(run.id)?.routes).toBeUndefined();
});
test("readiness is called with the flow id and the content hash of the run, and a one-argument readiness function still works", async () => {
  const readiness = vi.fn(() => ({ ready: true }));
  const c = await setup(manifest, { steps: { a: { text: "ok" } } }, { readiness });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: "/tmp" });
  expect(readiness).toHaveBeenCalledWith(expect.anything(), { flowId: run.flowId, hash: run.flowHash });
  const d = await setup(
    manifest,
    { steps: { a: { text: "ok" } } },
    { readiness: (m) => ({ ready: m.id === manifest.id }) },
  );
  stores.push(d.store);
  expect((await d.engine.startRun(manifest.id, { project: "/tmp" })).state).toBe("done");
});
