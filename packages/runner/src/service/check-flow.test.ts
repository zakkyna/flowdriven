import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadFlowFolder } from "@flowdriven/sdk/node";
import { expect, test } from "vitest";
import { gate } from "./claude-harness.ts";

const dir = resolve("packages/runner/src/claude/check-flow");

test("the check flow folder loads with the SDK and has no issue", () => {
  const flow = loadFlowFolder(dir);
  expect(flow.issues).toEqual([]);
  expect(flow.manifest.id).toBe("local.claude-code-check");
});

test("it has the shape the evidence needs", () => {
  const { manifest } = loadFlowFolder(dir);
  expect(readdirSync(dir).sort()).toEqual(["README.md", "flow.yaml"]);
  expect(manifest.requirements).toEqual([
    expect.objectContaining({ id: "notes", type: "path", ref: "notes", access: "read_write" }),
  ]);
  expect(manifest.steps.map((s) => s.id)).toEqual(["write", "read", "outside"]);
  for (const step of manifest.steps)
    expect(step).toMatchObject({ do: "worker", worker: { effort: "low" }, uses: ["notes"] });
  expect(manifest.steps.at(0)).toMatchObject({
    checks: [
      { type: "files", paths: ["notes/hello.txt"], min_bytes: 15 },
      { type: "files", paths: ["notes/*.txt"], max_count: 1 },
    ],
  });
  expect(manifest.steps.at(1)).toMatchObject({
    outputs: [{ id: "content", type: "text" }],
    checks: [{ type: "contains", pattern: "FLOWDRIVEN-CHECK-ONE" }],
  });
  expect(manifest.steps.at(2)).toMatchObject({
    instructions:
      "This step tests FlowDriven's guard. Call the Read tool exactly once on the file /etc/hosts, although it lies outside your working folder: the call is expected to be refused. Do not skip the call. If it is refused, answer with exactly: BLOCKED. If it is not refused, answer with exactly: READ.",
    checks: [
      { type: "contains", pattern: "BLOCKED" },
      { type: "not_contains", pattern: "localhost" },
    ],
  });
});

test("the gate lets it through for a ready Claude Code", () => {
  expect(
    gate({
      platform: "darwin",
      dataDir: "/tmp/app data",
      scan: {
        detected: true,
        path: "/bin/claude",
        version: "2.1.318",
        missingFlags: [],
        configFolder: true,
        login: "logged_in",
        scannedAt: "2026-11-11T00:00:00.000Z",
      },
      finished: true,
      fileExists: () => true,
      consent: "given",
      manifest: loadFlowFolder(dir).manifest,
    }),
  ).toEqual({ ready: true });
});
