import { mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { gate } from "../test-helpers/flows.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { triggerFlow, triggerRig } from "../test-helpers/trigger-rig.ts";
import { localDay } from "./schedule.ts";
import { createTriggerService } from "./service.ts";

afterEach(cleanup);
const id = "local.files";
async function rig(
  max = 20,
  options: { hold?: ReturnType<typeof gate>; noWatch?: boolean; onWatch?: () => void } = {},
) {
  const r = await triggerRig(
    [{ manifest: triggerFlow(id, [{ kind: "file_change", path: "inbox" }], { limits: { max_items: max } }) }],
    undefined,
    options,
  );
  mkdirSync(join(r.project, "inbox"));
  return r;
}
async function scan(r: Awaited<ReturnType<typeof rig>>) {
  r.signal();
  r.clock.advance(10_000);
  await r.svc.tick();
  await r.idle();
}
test("enabling takes a baseline: files that already exist do not fire", async () => {
  const r = await rig();
  r.writeFile("inbox/a.txt");
  r.enable(id, 0);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(id)).toHaveLength(0);
});
test("a signal and then the debounce fire one run with count, total and relative paths; before the debounce nothing fires", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.writeFile("inbox/a.txt");
  r.signal();
  r.clock.advance(9_999);
  await r.svc.tick();
  expect(r.runsOf(id)).toHaveLength(0);
  r.clock.advance(1);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(id).at(0)?.trigger?.payload).toEqual({ count: 1, total: 1, files: ["a.txt"] });
});
test("signals that keep coming delay the scan, but at 6 times the debounce (or 60 seconds) it scans anyway", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.writeFile("inbox/a.txt");
  r.signal();
  for (let i = 0; i < 6; i++) {
    r.clock.advance(10_000);
    r.signal();
    await r.svc.tick();
    if (i < 5) expect(r.runsOf(id)).toHaveLength(0);
  }
  await r.idle();
  expect(r.runsOf(id)).toHaveLength(1);
});
test("with no signal at all the scan still runs at start and every 5 minutes, so a change made while the runner was down fires once after a restart, and a second service over the same store does not fire it again", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.writeFile("inbox/a.txt");
  r.clock.advance(300_000);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(id)).toHaveLength(1);
  r.svc.stop();
  r.writeFile("inbox/b.txt");
  const make = () =>
    createTriggerService({
      store: r.store,
      now: r.clock.now,
      dayOf: localDay,
      projectDir: r.project,
      begin: r.engine.beginStart,
      every: () => () => {},
      watch: () => undefined,
      summaryOf: (t) => t.kind,
    });
  const second = make();
  await second.tick();
  expect(r.runsOf(id)).toHaveLength(2);
  const third = make();
  await third.tick();
  expect(r.runsOf(id)).toHaveLength(2);
  second.stop();
  third.stop();
});
test("more changed files than max_items: the first batch fires, the rest roll into the next fire, none is lost or repeated", async () => {
  const r = await rig(10);
  r.enable(id, 0);
  await r.svc.tick();
  for (let i = 0; i < 25; i++) r.writeFile(`inbox/${String(i).padStart(2, "0")}.txt`);
  await scan(r);
  for (let i = 0; i < 2; i++) {
    r.clock.advance(10_000);
    await r.svc.tick();
    await r.idle();
  }
  const payloads = r.runsOf(id).map((x) => x.trigger?.payload as { count: number; files: string[] });
  expect(payloads.map((p) => p.count).sort((a, b) => b - a)).toEqual([10, 10, 5]);
  expect(new Set(payloads.flatMap((p) => p.files)).size).toBe(25);
});
test("a file that did not change in size or mtime never fires twice; a new mtime fires again", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.writeFile("inbox/a.txt", "x", 1000);
  await scan(r);
  r.writeFile("inbox/a.txt", "x", 1000);
  await scan(r);
  expect(r.runsOf(id)).toHaveLength(1);
  r.writeFile("inbox/a.txt", "x", 2000);
  await scan(r);
  expect(r.runsOf(id)).toHaveLength(2);
});
test("a root swapped for a symlink to a folder outside the project, after enabling, is refused at the next scan, fires nothing and the view says why", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  const outside = join(tempPath(), "..");
  renameSync(join(r.project, "inbox"), join(r.project, "old"));
  symlinkSync(outside, join(r.project, "inbox"));
  r.signal();
  r.clock.advance(10_000);
  await r.svc.tick();
  expect(r.runsOf(id)).toHaveLength(0);
  expect(r.svc.list(id).at(0)?.reason).toBe("Only folders inside the project folder can be watched for now.");
  expect(r.store.getTrigger(id, 0)?.lastFire?.outcome).toBe("refused");
});
test("500 changed files with max_items 1 and the default cap give 24 runs, 476 dropped and one flood event, and the next local day does not replay them", async () => {
  const r = await rig(1);
  r.enable(id, 0);
  await r.svc.tick();
  for (let i = 0; i < 500; i++) r.writeFile(`inbox/${String(i).padStart(3, "0")}.txt`);
  for (let i = 0; i < 500; i++) await scan(r);
  expect(r.runsOf(id)).toHaveLength(24);
  expect(r.store.counter(`dropped:${id}`, "2026-11-11")).toBe(476);
  expect(r.floods).toEqual([{ flowId: id, flowName: "Test", day: "2026-11-11", cap: 24 }]);
  r.setDay(() => "2026-11-12");
  await scan(r);
  expect(r.runsOf(id)).toHaveLength(24);
});
test("while a run is open and 2 are queued a fire is retried on a later tick and consumes nothing", async () => {
  const hold = gate();
  const r = await rig(1, { hold });
  r.enable(id, 0);
  await r.svc.tick();
  for (let i = 0; i < 4; i++) r.writeFile(`inbox/${i}.txt`);
  for (let i = 0; i < 4; i++) {
    r.signal();
    r.clock.advance(10_000);
    await r.svc.tick();
  }
  expect(r.runsOf(id)).toHaveLength(3);
  expect(r.store.getTrigger(id, 0)?.lastFire?.outcome).toBe("dropped_queue_full");
  hold.release();
  hold.release();
  hold.release();
  await r.idle();
  r.signal();
  r.clock.advance(10_000);
  await r.svc.tick();
  expect(r.runsOf(id)).toHaveLength(4);
  hold.release();
  await r.idle();
});
test("a watcher that cannot start falls back to the 5 minute scan and the view says so", async () => {
  const r = await rig(20, { noWatch: true });
  r.enable(id, 0);
  await r.svc.tick();
  expect(r.svc.list(id).at(0)?.reason).toBe(
    "Watching is not available here; this folder is checked every 5 minutes.",
  );
  r.writeFile("inbox/a.txt");
  r.clock.advance(300_000);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(id)).toHaveLength(1);
});
test("switching off, a hash change and stop() close the watcher", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  expect(r.watchers.size).toBe(1);
  r.svc.setEnabled(id, 0, false, r.hashOf(id));
  expect(r.watchers.size).toBe(0);
  r.enable(id, 0);
  await r.svc.tick();
  expect(r.watchers.size).toBe(1);
  const flow = triggerFlow(id, [{ kind: "file_change", path: "inbox" }]);
  r.engine.registerFlow({ ...flow, name: "Changed" }, `sha256:${"f".repeat(64)}`);
  await r.svc.tick();
  expect(r.watchers.size).toBe(0);
  r.engine.registerFlow(flow, r.hashOf(id));
  await r.svc.tick();
  expect(r.watchers.size).toBe(1);
  r.svc.stop();
  expect(r.watchers.size).toBe(0);
});
test("an unreadable snapshot row becomes a new baseline and fires nothing", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.store.putSetting(`snap:${id}:0`, { broken: "value" });
  r.writeFile("inbox/a.txt");
  await scan(r);
  expect(r.runsOf(id)).toHaveLength(0);
  r.writeFile("inbox/b.txt");
  await scan(r);
  expect(r.runsOf(id)).toHaveLength(1);
});

test("a watcher error closes it and falls back to periodic scans", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.watchError();
  expect(r.watchers.size).toBe(0);
  expect(r.svc.list(id).at(0)?.reason).toBe(
    "Watching is not available here; this folder is checked every 5 minutes.",
  );
  r.writeFile("inbox/a.txt");
  r.clock.advance(300_000);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(id)).toHaveLength(1);
});

test("after stop, poke and tick do not start runs or create watchers", async () => {
  let calls = 0;
  const r = await rig(20, { onWatch: () => calls++ });
  r.enable(id, 0);
  r.svc.start();
  await r.idle();
  expect(r.watchers.size).toBe(1);
  r.svc.stop();
  r.writeFile("inbox/a.txt");
  r.svc.poke();
  await r.svc.tick();
  await r.idle();
  expect(r.watchers.size).toBe(0);
  expect(calls).toBe(1);
  expect(r.runsOf(id)).toHaveLength(0);
});

test("distinct file batches with delimiter characters both fire", async () => {
  const r = await rig();
  r.enable(id, 0);
  await r.svc.tick();
  r.writeFile("inbox/a", "x", 1000);
  r.writeFile("inbox/b", "x", 1000);
  await scan(r);
  rmSync(join(r.project, "inbox/a"));
  rmSync(join(r.project, "inbox/b"));
  r.writeFile(`inbox/a|1|1000${String.fromCodePoint(10)}b`, "x", 1000);
  await scan(r);
  expect(r.runsOf(id)).toHaveLength(2);
});
