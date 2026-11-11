// Belongs in: packages/runner/src/service/review-03-a1.test.ts
import { FlowManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { gate } from "./claude-harness.ts";

const scan = {
  detected: true,
  path: "/bin/claude",
  version: "2.1.318",
  missingFlags: [],
  configFolder: true,
  login: "logged_in" as const,
  scannedAt: "2026-11-11T00:00:00.000Z",
};
test("a flow with a skill step that names no requirement is refused by the gate, before an earlier step runs", () => {
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    requirements: [{ id: "notes", type: "path", ref: "notes", access: "read_write" }],
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "write",
        uses: ["notes"],
        checks: [{ type: "contains", pattern: "x" }],
      },
      {
        id: "b",
        do: "skill",
        skill: "builder",
        instructions: "build",
        checks: [{ type: "contains", pattern: "x" }],
      },
    ],
  });
  const result = gate({
    platform: "darwin",
    dataDir: "/tmp/app data",
    scan,
    finished: true,
    fileExists: () => true,
    consent: "given",
    manifest,
  });
  // The adapter blocks every skill step at run time with "Skill steps are not run yet.", after step a has run.
  expect(result.ready).toBe(false);
});
