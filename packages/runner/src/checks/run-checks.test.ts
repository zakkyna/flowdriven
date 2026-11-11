import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Check } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { scriptedHarness } from "../scripted-harness.ts";
import { defaultCommandRunner } from "./command.ts";
import { type CheckContext, runChecks } from "./run-checks.ts";

const dirs: string[] = [];
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.FLOWDRIVEN_TEST_SECRET;
});
const harness = scriptedHarness({ judge: () => ({ verdict: "passed", reasons: "ok", evidence: "line 3" }) });
const ctx = (overrides: Partial<CheckContext> = {}): CheckContext => ({
  runId: "r",
  stepId: "s",
  itemKey: "",
  folder: folder(),
  files: new Map(),
  declaredOutputs: [],
  output: { text: "", values: {} },
  bind: (t) => t,
  harness,
  signal: new AbortController().signal,
  runCommand: async () => ({ code: 0, stderr: "" }),
  ...overrides,
});
const checks = (values: unknown[]): Check[] => values as Check[];
test("contains and not_contains bind patterns and report evidence", async () => {
  const [a, b] = await runChecks(
    checks([
      { type: "contains", required: true, patterns: ["/p/"] },
      { type: "not_contains", required: true, patterns: ["@", "whatsapp"], ignore_case: true },
    ]),
    ctx({ output: { text: "see /p/1 mail a@b.c", values: {} } }),
  );
  expect(a?.verdict).toBe("passed");
  expect(b).toMatchObject({ verdict: "failed", evidence: expect.stringContaining("'@' at offset 15") });
  const [c] = await runChecks(
    checks([{ type: "contains", required: true, pattern: "${job.title}" }]),
    ctx({ output: { text: "Hello T1", values: {} }, bind: (t) => t.replace("${job.title}", "T1") }),
  );
  expect(c?.verdict).toBe("passed");
});
test("files: existence, count and size bounds, and no escape from the folder", async () => {
  const dir = folder();
  const outside = folder();
  mkdirSync(join(dir, "out"));
  writeFileSync(join(dir, "out/a.md"), "abc");
  writeFileSync(join(outside, "x"), "x");
  symlinkSync(join(outside, "x"), join(dir, "out/link"));
  const run = async (paths: string[], extra: object = {}) =>
    (
      await runChecks(
        checks([{ type: "files", required: true, paths, ...extra }]),
        ctx({ folder: dir, bind: (t) => t.replace("${dir}", "out") }),
      )
    ).at(0);
  expect((await run(["out/*.md"], { min_count: 1 }))?.verdict).toBe("passed");
  expect((await run(["out/missing.md"]))?.verdict).toBe("failed");
  expect((await run(["out/*.md"], { min_bytes: 4 }))?.verdict).toBe("failed");
  for (const path of ["../x", "/etc/hosts", "out/link"])
    expect(await run([path])).toMatchObject({
      verdict: "failed",
      evidence: expect.stringContaining("outside the project folder"),
    });
  expect((await run(["${dir}/a.md"]))?.verdict).toBe("passed");
});
test("schema: the only output, a named output or the text; fails on a bad value or an unsupported keyword", async () => {
  const files = new Map([
    [
      "checks/s.json",
      JSON.stringify({
        type: "object",
        required: ["value"],
        properties: { value: { type: "number", minimum: 0 } },
      }),
    ],
    ["bad", '{"$ref":"x"}'],
  ]);
  const run = async (extra: Partial<CheckContext>, file = "checks/s.json", of?: string) =>
    (
      await runChecks(
        checks([{ type: "schema", required: true, file, ...(of ? { of } : {}) }]),
        ctx({ files, ...extra }),
      )
    ).at(0);
  expect(
    (await run({ declaredOutputs: ["score"], output: { text: "", values: { score: { value: 3 } } } }))
      ?.verdict,
  ).toBe("passed");
  expect(
    (
      await run(
        { declaredOutputs: [], output: { text: "", values: { score: { value: -1 } } } },
        "checks/s.json",
        "score",
      )
    )?.verdict,
  ).toBe("failed");
  expect((await run({ output: { text: "not json", values: {} } }))?.verdict).toBe("failed");
  expect(await run({}, "bad")).toMatchObject({
    verdict: "failed",
    evidence: expect.stringContaining("unsupported schema keyword $ref"),
  });
});
test("command: exit 0 passes, otherwise fails with the end of stderr", async () => {
  let seen: unknown;
  const c = ctx({
    runCommand: async (...args) => {
      seen = args;
      return { code: 0, stderr: "" };
    },
  });
  const check = checks([{ type: "command", required: true, cmd: "tool", args: ["one"] }]);
  expect((await runChecks(check, c)).at(0)?.verdict).toBe("passed");
  expect(seen).toEqual(["tool", ["one"], expect.objectContaining({ cwd: c.folder })]);
  c.runCommand = async () => ({ code: 1, stderr: "x".repeat(5000) + "3 errors" });
  const result = (await runChecks(check, c)).at(0);
  expect(result?.verdict).toBe("failed");
  expect(result?.evidence?.endsWith("3 errors")).toBe(true);
  expect(result?.evidence?.length).toBeLessThanOrEqual(2000);
});
test("the default command runner uses no shell and an explicit environment", async () => {
  process.env.FLOWDRIVEN_TEST_SECRET = "s";
  const script =
    "process.exit(process.argv[1] === 'a;b' && process.env.FLOWDRIVEN_TEST_SECRET === undefined && process.env.PATH ? 0 : 3)";
  expect(
    (
      await defaultCommandRunner()(process.execPath, ["-e", script, "a;b"], {
        cwd: folder(),
        timeoutMs: 10_000,
        signal: new AbortController().signal,
      })
    ).code,
  ).toBe(0);
});
test("an earlier failing automated check skips judge and user", async () => {
  harness.judgeCalls.length = 0;
  const out = await runChecks(
    checks([
      { type: "judge", required: true, rubric: "r.md" },
      { type: "contains", required: true, pattern: "zzz" },
      { type: "user", required: true },
    ]),
    ctx({ output: { text: "abc", values: {} } }),
  );
  expect(out.map((o) => o.verdict)).toEqual(["pending", "failed", "pending"]);
  expect(out.at(0)?.summary).toBe("not run: an earlier check failed");
  expect(harness.judgeCalls).toEqual([]);
});
test("judge needs evidence; user is pending", async () => {
  const h = scriptedHarness({ judge: () => ({ verdict: "passed", reasons: "ok", evidence: "" }) });
  const c = ctx({ harness: h, files: new Map([["r.md", "rubric"]]) });
  const judge = checks([{ type: "judge", required: true, rubric: "r.md" }]);
  expect((await runChecks(judge, c)).at(0)).toMatchObject({
    verdict: "failed",
    evidence: "the judge quoted no evidence",
  });
  c.harness = harness;
  expect((await runChecks(judge, c)).at(0)?.verdict).toBe("passed");
  expect((await runChecks(checks([{ type: "user", required: true }]), c)).at(0)?.verdict).toBe("pending");
});
