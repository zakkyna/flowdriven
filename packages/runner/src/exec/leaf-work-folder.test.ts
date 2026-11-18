import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { scriptedHarness } from "../scripted-harness.ts";
import type { Store } from "../storage.ts";
import { setup } from "../test-helpers/engine.ts";

const folders: string[] = [],
  stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
async function run(
  workFolder: string | undefined,
  check: object,
  runCommand?: import("../checks/command.ts").CommandRunner,
) {
  const project = mkdtempSync(join(tmpdir(), "project-check-"));
  folders.push(project);
  writeFileSync(join(project, "project.txt"), "project");
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.work",
    name: "Work",
    kind: "build",
    requirements: [{ id: "cli", type: "cli_tool", commands: ["check"] }],
    steps: [{ id: "work", do: "worker", instructions: "Work", uses: ["cli"], retry: 0, checks: [check] }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const harness = scriptedHarness({ steps: { work: { text: "ok" } } });
  const original = harness.runStep;
  harness.runStep = async (req) => ({
    ...(await original(req)),
    ...(workFolder === undefined ? {} : { workFolder }),
  });
  const c = await setup(parsed.manifest, {}, { harness, ...(runCommand ? { runCommand } : {}) });
  stores.push(c.store);
  const result = await c.engine.startRun(parsed.manifest.id, { project });
  return { result, project };
}
test("a files check reads the step's own folder when it works in a granted folder, and the project folder otherwise", async () => {
  const work = mkdtempSync(join(tmpdir(), "work-check-"));
  folders.push(work);
  writeFileSync(join(work, "work.txt"), "work");
  expect((await run(work, { type: "files", paths: ["work.txt"], min_count: 1 })).result.state).toBe("done");
  expect((await run(work, { type: "files", paths: ["project.txt"], min_count: 1 })).result.state).not.toBe(
    "done",
  );
  expect((await run(undefined, { type: "files", paths: ["project.txt"], min_count: 1 })).result.state).toBe(
    "done",
  );
});
test("a command check still runs in the project folder when the step works in a granted folder", async () => {
  const work = mkdtempSync(join(tmpdir(), "work-check-"));
  folders.push(work);
  let cwd = "";
  const result = await run(
    work,
    { type: "command", cmd: "check", args: [] },
    async (_cmd, _args, options) => {
      cwd = options.cwd;
      return { code: 0, stderr: "" };
    },
  );
  expect(result.result.state).toBe("done");
  expect(cwd).toBe(result.project);
});
