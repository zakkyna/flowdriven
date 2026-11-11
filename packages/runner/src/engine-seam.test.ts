import { expect, test, vi } from "vitest";
import { scriptedHarness } from "./scripted-harness.ts";
import { setup } from "./test-helpers/engine.ts";
import { makeFlow } from "./test-helpers/review-flow.ts";

const requirements = [
  { id: "notes", type: "path", ref: "notes", access: "read_write" },
  { id: "h", type: "harness" },
  { id: "host", type: "mcp_server", tools: ["publish"] },
];
const worker = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  do: "worker",
  instructions: "Work",
  checks: [{ type: "contains", pattern: "ok" }],
  ...extra,
});

test("a step request carries the project, the frozen requirements the step uses in order, and the effort", async () => {
  const c = await setup(
    makeFlow([worker("a", { uses: ["h", "notes"], worker: { effort: "high" } }), worker("b", { uses: [] })], {
      requirements,
    }),
    { steps: { a: { text: "ok" }, b: { text: "ok" } } },
  );
  try {
    await c.engine.startRun("local.test", { project: "/tmp/p" });
    const a = c.harness.calls.at(0);
    const b = c.harness.calls.at(1);
    expect(a).toBeDefined();
    expect(a?.project).toBe("/tmp/p");
    expect(a?.requirements.map((r) => r.id)).toEqual(["h", "notes"]);
    expect(a?.effort).toBe("high");
    expect(b).toBeDefined();
    expect(b?.requirements).toEqual([]);
    expect(b && Object.hasOwn(b, "effort")).toBe(false);
  } finally {
    c.store.close();
  }
});

test("a block sentence ends the attempt as failed, blocks the run with it and does not retry", async () => {
  const c = await setup(makeFlow([worker("a", { retry: 2 })], { requirements }), {
    steps: { a: { exit: "failed", text: "ok", block: "Stop here." } },
  });
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp/p" });
    const row = c.engine.getRun(run.id).steps.at(0);
    expect(c.harness.calls).toHaveLength(1);
    expect(run).toMatchObject({ state: "blocked", blockedReason: "Stop here." });
    expect(row).toMatchObject({ state: "failed", note: "Stop here." });
    expect(row?.attempts).toHaveLength(1);
    expect(row?.attempts.at(0)).toMatchObject({ exit: "failed", endedAt: expect.any(String) });
  } finally {
    c.store.close();
  }
});

test("a block wins over exit ok", async () => {
  const c = await setup(
    makeFlow([worker("a", { checks: [{ type: "contains", pattern: "zzz" }] })], { requirements }),
    { steps: { a: { exit: "ok", text: "fine", block: "No." } } },
  );
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp/p" });
    const row = c.engine.getRun(run.id).steps.at(0);
    expect(run).toMatchObject({ state: "blocked", blockedReason: "No." });
    expect(row).toMatchObject({ state: "failed", note: "No.", checks: [] });
    expect(row?.attempts).toHaveLength(1);
    expect(row?.attempts.at(0)).toMatchObject({ exit: "failed", endedAt: expect.any(String) });
  } finally {
    c.store.close();
  }
});

test("shutdown calls the adapter's stop once, and a stop that throws does not stop the shutdown", async () => {
  const stop = vi.fn();
  const c = await setup(
    makeFlow([worker("a")], { requirements }),
    {},
    { harness: { ...scriptedHarness({}), stop } },
  );
  const throwing = await setup(
    makeFlow([worker("a")], { requirements }),
    {},
    {
      harness: {
        ...scriptedHarness({}),
        stop: () => {
          throw new Error("boom");
        },
      },
    },
  );
  try {
    c.engine.shutdown();
    c.engine.shutdown();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(() => throwing.engine.shutdown()).not.toThrow();
    expect(() => throwing.engine.beginStart("local.test", { project: "/tmp/p" })).toThrow(
      "The engine is stopping.",
    );
  } finally {
    c.store.close();
    throwing.store.close();
  }
});

test("a harness without stop shuts down as before", async () => {
  const c = await setup(makeFlow([worker("a")], { requirements }), {});
  try {
    expect(() => c.engine.shutdown()).not.toThrow();
  } finally {
    c.store.close();
  }
});
