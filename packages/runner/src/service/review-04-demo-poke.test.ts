// Proof for review-04 finding: in demo mode the trigger service never starts, but
// observeStore's onRunState pokes it on every run that ends, so an enabled row in
// the store fires anyway. Copy to packages/runner/src/service/review-04-demo-poke.test.ts
// and fix the import prefix (../ -> ../) to run in the suite.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { scriptedHarness } from "../scripted-harness.ts";
import { createRunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { triggerFlow } from "../test-helpers/trigger-rig.ts";

const hash = `sha256:${"1".repeat(64)}`;
test("demo mode starts no triggers: a run that ends does not fire an enabled schedule row", async () => {
  const dataDir = dirname(tempPath());
  const store = await openSqliteStore(":memory:");
  let time = Date.parse("2026-11-12T00:00:00.000Z");
  let n = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "demo",
    now: () => new Date(time),
    newId: (p) => `${p}-${++n}`,
    harness: scriptedHarness({ steps: { a: { text: "x", outputs: { draft: "x" } } } }),
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {}, watch: () => () => {} },
  });
  try {
    mkdirSync(join(dataDir, "demo-project"), { recursive: true });
    const flow = triggerFlow("local.demo-poke", [{ kind: "schedule", every: "1h" }]);
    service.engine.registerFlow(flow, hash);
    await service.start().settled;
    // A row as a live data folder holds it (FLOWDRIVEN_DATA_DIR shared with --demo).
    store.putTrigger({
      flowId: flow.id,
      index: 0,
      enabled: true,
      hash,
      spec: JSON.stringify(flow.triggers.at(0)),
      enabledAt: "2026-11-11T23:00:00.000Z",
      cursorMs: Date.parse("2026-11-11T23:00:00.000Z"),
    });
    time += 30_000; // 00:00:30, the 00:00 slot is on time
    const manual = await service.engine.beginStart(flow.id, { project: join(dataDir, "demo-project") })
      .settled;
    expect(manual.state).toBe("done");
    for (let i = 0; i < 200; i++) await Promise.resolve();
    const triggered = store.listRuns({ flowId: flow.id }).filter((r) => r.trigger?.kind === "schedule");
    expect(triggered).toHaveLength(0);
  } finally {
    service.stop();
    store.close();
    cleanup();
  }
});
