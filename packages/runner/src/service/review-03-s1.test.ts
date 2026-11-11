// Belongs in packages/runner/src/service/review-03-s1.test.ts
// S1: consent taken back while a run waits at an ask; answering the ask runs the next worker step on Claude Code anyway.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { CLAUDE_ID } from "./claude-harness.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const roots: string[] = [];
const stores: Store[] = [];
const services: RunnerService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function until<T>(fn: () => T | undefined): Promise<T> {
  for (let i = 0; i < 1000; i++) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Timed out");
}
test("S1 a run resumed by an answer after consent was taken back does not start Claude Code", {
  timeout: 20_000,
}, async () => {
  const h = makeFakeHome();
  roots.push(h);
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dataDir);
  const s = await openSqliteStore(":memory:");
  stores.push(s);
  const path = join(dataDir, "project/notes/hello.txt");
  writeFakeScript(h, {
    plays: [
      {
        when: "List the jobs",
        actions: [
          { do: "tool", id: "so1", name: "StructuredOutput", input: {} },
          {
            do: "result",
            result: "listed",
            structured: { report: "listed", outputs: { jobs: [{ id: "a" }], message: "listed" } },
          },
        ],
      },
      {
        when: "Write the note",
        actions: [
          {
            do: "tool",
            id: "t1",
            name: "Write",
            input: { file_path: path, content: "hello" },
            write: { path, text: "hello" },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  let n = 0;
  const service = createRunnerService({
    store: s,
    dataDir,
    mode: "live",
    env: { HOME: h, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date("2026-11-11T00:00:00.000Z"),
    newId: (p) => `${p}-${++n}`,
  });
  services.push(service);
  await service.start().settled;
  await service.call("harnesses.setConsent", { harnessId: CLAUDE_ID, consent: "given" });
  const m = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    requirements: [{ id: "notes", type: "path", ref: "notes", access: "read_write" }],
    steps: [
      {
        id: "list",
        do: "worker",
        instructions: "List the jobs",
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", of: "message", pattern: "listed" }],
      },
      { id: "pick", do: "ask", ask: { question: "Go on?", choose_from: "${steps.list.outputs.jobs}" } },
      {
        id: "s",
        do: "worker",
        instructions: "Write the note",
        checks: [{ type: "files", paths: ["notes/hello.txt"] }],
        uses: ["notes"],
      },
    ],
  });
  service.engine.registerFlow(m, DEMO_HASH, {});
  const run = (await service.call("flows.run", { flowId: m.id })) as { id: string };
  await until(() =>
    ["waiting_approval", "blocked", "failed", "done"].includes(String(s.getRun(run.id)?.state))
      ? true
      : undefined,
  );
  expect(s.getRun(run.id)).toMatchObject({ state: "waiting_approval" });
  // The owner takes the consent back while the run waits.
  await service.call("harnesses.setConsent", { harnessId: CLAUDE_ID, consent: "revoked" });
  const approval = s.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!approval) throw Error("no approval");
  const payload = approval.payload as { options: { key: string }[] };
  const key = payload.options.at(0)?.key ?? "";
  await service.engine.answerAsk(approval.id, { picks: [key] });
  await until(() =>
    ["done", "blocked", "failed"].includes(String(s.getRun(run.id)?.state)) ? true : undefined,
  );
  const steps = readFakeCalls(h).filter(
    (c) => c.kind === "call" && c.args.includes("-p") && (c.prompt ?? "").includes("Write the note"),
  );
  expect(steps).toEqual([]);
  expect(s.getRun(run.id)?.state).toBe("blocked");
});
