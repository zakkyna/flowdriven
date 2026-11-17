import { tmpdir } from "node:os";
import { expect, test, vi } from "vitest";
import { setup } from "../test-helpers/engine.ts";
import { oneStepFlow } from "../test-helpers/flows.ts";
import { createKeepAwake } from "./keep-awake.ts";

test("on darwin createKeepAwake spawns /usr/bin/caffeinate -i -w <pid>; elsewhere it is undefined", () => {
  const spawn = vi.fn(() => ({ on: vi.fn() }));
  const options = { platform: "darwin", spawn, onError: vi.fn() };
  createKeepAwake(options)?.(42);
  expect(spawn).toHaveBeenCalledExactlyOnceWith("/usr/bin/caffeinate", ["-i", "-w", "42"]);
  expect(createKeepAwake({ ...options, platform: "linux" })).toBeUndefined();
});

test("a spawn error is written to the audit log as keep_awake_failed and the step goes on", {
  timeout: 20_000,
}, async () => {
  const c = await setup(oneStepFlow("local.awake", { limits: { max_duration: "150m" } }), {
    steps: {
      a: (req) => {
        req.onStart?.(42);
        return { text: "x", outputs: { draft: "x" } };
      },
    },
  });
  const keepAwake = createKeepAwake({
    platform: "darwin",
    spawn: () => ({ on: (_event, f) => f() }),
    onError: () =>
      c.store.appendAudit({ at: c.clock.now().toISOString(), kind: "keep_awake_failed", detail: {} }),
  });
  const { createEngine } = await import("../engine.ts");
  const engine = createEngine({ store: c.store, harness: c.harness, keepAwake });
  const run = await engine.startRun("local.awake", { project: tmpdir() });
  expect(run.state).toBe("done");
  expect(c.store.listAudit().some((entry) => entry.kind === "keep_awake_failed")).toBe(true);
  c.store.close();
});
