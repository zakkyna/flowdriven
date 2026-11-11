import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Value } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { escapeText } from "./report.ts";
import { setup } from "./test-helpers/engine.ts";
import { makeFlow } from "./test-helpers/review-flow.ts";

const worker = { id: "a", do: "worker", instructions: "Work", checks: [{ type: "contains", pattern: "ok" }] };

test("refused triggered starts do not consume the daily limit", async () => {
  const manifest = makeFlow([worker], {
    triggers: [{ kind: "schedule", every: "1h" }],
    limits: { max_runs_per_day: 1 },
    inputs: [{ id: "required_input", type: "text", label: "Input", required: true }],
    params: { count: { type: "number", default: 1 } },
  });
  const { engine, store } = await setup(manifest, { steps: { a: { text: "ok" } } });
  try {
    const options = { project: "/tmp", trigger: { kind: "schedule" } };
    await expect(
      engine.startRun(manifest.id, { ...options, params: { count: "bad" } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(engine.startRun(manifest.id, options)).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      (await engine.startRun(manifest.id, { ...options, inputs: { required_input: "yes" } })).state,
    ).toBe("done");
    await expect(
      engine.startRun(manifest.id, { ...options, inputs: { required_input: "yes" } }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  } finally {
    store.close();
  }
});

test("parameter bounds and enum options are enforced at start", async () => {
  const manifest = makeFlow([worker], {
    params: {
      count: { type: "number", min: 1, max: 3, default: 2 },
      choice: { type: "enum", options: ["a", "b"], default: "a" },
    },
  });
  const { engine, store } = await setup(manifest, { steps: { a: { text: "ok" } } });
  try {
    const invalidParams: Record<string, Value>[] = [{ count: 0 }, { count: 4 }, { choice: "c" }];
    for (const params of invalidParams)
      await expect(engine.startRun(manifest.id, { project: "/tmp", params })).rejects.toMatchObject({
        code: "invalid_input",
      });
    for (const count of [1, 3])
      expect(
        (await engine.startRun(manifest.id, { project: "/tmp", params: { count, choice: "b" } })).state,
      ).toBe("done");
  } finally {
    store.close();
  }
});

test("resume processes items skipped after a stopped failure", async () => {
  const manifest = makeFlow([
    {
      id: "source",
      do: "worker",
      instructions: "Find",
      outputs: [
        { id: "jobs", type: "json" },
        { id: "message", type: "text" },
      ],
      checks: [{ type: "contains", pattern: "j1" }],
    },
    {
      id: "loop",
      for_each: "${steps.source.outputs.jobs}",
      as: "job",
      key: "${job.id}",
      on_item_fail: "stop",
      steps: [worker],
    },
  ]);
  let fail = true;
  const { engine, store, harness } = await setup(manifest, {
    steps: {
      source: { text: "j1", outputs: { jobs: [{ id: "j1" }, { id: "j2" }, { id: "j3" }], message: "ok" } },
      a: (req) => ({ text: req.itemKey === "j2" && fail ? "bad" : "ok" }),
    },
  });
  try {
    const run = await engine.startRun(manifest.id, { project: "/tmp" });
    expect(run).toMatchObject({ state: "blocked", blockedReason: 'Blocked at step "loop": item j2 failed.' });
    expect(store.listItems(run.id).map((item) => item.status)).toEqual(["passed", "failed", "skipped"]);
    fail = false;
    expect((await engine.resumeRun(run.id)).state).toBe("done");
    expect(store.listItems(run.id).map((item) => item.status)).toEqual(["passed", "passed", "passed"]);
    expect(harness.calls.filter((call) => call.stepId === "a").map((call) => call.itemKey)).toContain("j3");
  } finally {
    store.close();
  }
});

test("report escapes HTML, Markdown and Unicode separators in outside text", () => {
  const separators = String.fromCodePoint(0x2028, 0x2029);
  expect(escapeText(`<img src=x> & ![x](javascript:bad) *_#${separators}`)).toBe(
    "&lt;img src=x&gt; &amp; \\!\\[x\\]\\(javascript:bad\\) \\*\\_\\#<U+2028><U+2029>",
  );
});

const demoMock = vi.hoisted(() => ({ run: vi.fn(), dir: "" }));
vi.mock("./demo/demo.ts", () => ({ runDemo: demoMock.run }));
vi.mock("./entry.ts", () => ({ silenceSqliteWarning: () => undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdtemp: async () => {
      const dir = join(demoMock.dir, "database");
      await original.mkdir(dir);
      return dir;
    },
  };
});
const dirs: string[] = [];
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("demo removes its temporary database after success and failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  demoMock.dir = dir;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  demoMock.run.mockResolvedValueOnce({ files: [] }).mockRejectedValueOnce(new Error("demo failed"));
  await import("./demo/main.ts");
  expect(readdirSync(dir)).toEqual([]);
  vi.resetModules();
  await expect(import("./demo/main.ts")).rejects.toThrow("demo failed");
  expect(readdirSync(dir)).toEqual([]);
});
