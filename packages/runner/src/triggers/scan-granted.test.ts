import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { oneStepFlow } from "../test-helpers/flows.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { triggerRig } from "../test-helpers/trigger-rig.ts";
import { resolveRoot, scanFolder } from "./scan.ts";

afterEach(cleanup);
const reason = "Only folders inside the project folder or a folder you granted to this flow can be watched.";
const id = "local.granted";
async function rig(path = "~/work/sub") {
  const home = realpathSync(dirname(tempPath()));
  const project = join(home, "project");
  const dataDir = join(home, "data");
  const folder = join(home, "work");
  mkdirSync(join(folder, "sub"), { recursive: true });
  mkdirSync(project);
  mkdirSync(dataDir);
  const manifest = FlowManifest.parse({
    ...oneStepFlow(id),
    requirements: [{ id: "work", type: "path", ref: "~/work", access: "read" }],
    triggers: [{ kind: "file_change", path }],
  });
  const r = await triggerRig([{ manifest }], undefined, { project, home, dataDir });
  const grant = (flowId = id, hash = r.hashOf(id)) =>
    r.store.putCapabilityConsent({
      flowId,
      hash,
      at: r.clock.now().toISOString(),
      pins: { skills: {}, folders: { work: { path: folder, access: "read" } } },
    });
  return { ...r, home, dataDir, folder, grant };
}

test("a file_change path inside a granted folder can be watched", async () => {
  const r = await rig();
  r.grant();
  expect(
    resolveRoot(r.project, "~/work/sub", { home: r.home, dataDir: r.dataDir, folders: [r.folder] }),
  ).toEqual({ ok: true, root: join(r.folder, "sub"), within: r.folder });
  expect(r.svc.list(id).at(0)?.canEnable).toBe(true);
  r.enable(id, 0);
  await r.svc.tick();
  expect(r.watchers.has(join(r.folder, "sub"))).toBe(true);
});

test("a path in a folder granted to another flow, or a folder that is no longer granted, is refused", async () => {
  const r = await rig();
  r.grant("local.other");
  expect(r.svc.list(id).at(0)?.reason).toBe(reason);
  expect(() => r.enable(id, 0)).toThrow(reason);
  r.grant(id, `sha256:${"f".repeat(64)}`);
  expect(() => r.enable(id, 0)).toThrow(reason);
  r.grant();
  r.store.deleteCapabilityConsent(id);
  expect(() => r.enable(id, 0)).toThrow(reason);
  expect(resolveRoot(r.project, "~/work/sub")).toEqual({ ok: false, reason });
  expect(
    resolveRoot(r.project, "~/work/../project", { home: r.home, dataDir: r.dataDir, folders: [r.folder] }),
  ).toEqual({ ok: false, reason });
});

test("a symlink out of the granted folder is refused", async () => {
  const r = await rig("~/work/link");
  const outside = join(r.home, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(outside, join(r.folder, "link"));
  r.grant();
  expect(() => r.enable(id, 0)).toThrow(reason);
  const scanned = scanFolder(r.folder, { glob: "**", maxEntries: 100, within: r.folder });
  expect(scanned.files).toEqual({});
  expect(scanFolder(join(r.folder, "link"), { glob: "**", maxEntries: 100, within: r.folder }).outside).toBe(
    true,
  );
});

test("after Withdraw the watch stops and the trigger says why", async () => {
  const r = await rig();
  r.grant();
  r.enable(id, 0);
  await r.svc.tick();
  expect(r.watchers.size).toBe(1);
  r.store.deleteCapabilityConsent(id);
  await r.svc.tick();
  expect(r.watchers.size).toBe(0);
  expect(r.store.getTrigger(id, 0)?.lastFire).toMatchObject({ outcome: "refused", detail: reason });
});

test("a project folder path is watched as before", async () => {
  const r = await rig("inbox");
  mkdirSync(join(r.project, "inbox"));
  expect(resolveRoot(r.project, "inbox")).toEqual({ ok: true, root: join(r.project, "inbox") });
  expect(resolveRoot(r.project, join(r.project, "inbox"))).toEqual({
    ok: true,
    root: join(r.project, "inbox"),
  });
  r.enable(id, 0);
  await r.svc.tick();
  expect(r.watchers.has(join(r.project, "inbox"))).toBe(true);
});
