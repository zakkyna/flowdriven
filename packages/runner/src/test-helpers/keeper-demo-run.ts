import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueView, RunDetail } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import { createRunnerService, DEMO_HASH } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, writeFakeScript } from "./fake-claude-script.ts";

export async function runKeeperDemo(o: { releaseFile: string }): Promise<string[]> {
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  const home = makeFakeHome();
  const store = await openSqliteStore(":memory:");
  let id = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date("2026-11-11T00:00:00.000Z"),
    newId: (prefix) => `${prefix}-${++id}`,
    keeper: {
      probes: {
        refresh: async () => {},
        availableMb: () => 8000,
        pressureLevel: () => 1,
        groupRssMb: () => undefined,
        totalMb: () => 16000,
      },
      every: () => () => {},
    },
  });
  try {
    const usage = {
      models: [{ model: "claude-haiku-5-5", input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 }],
      turns: 2,
    };
    const result = {
      do: "result" as const,
      result: "x",
      structured: { report: "x", outputs: { draft: "x" } },
      usage,
    };
    writeFakeScript(home, {
      plays: [
        { when: "ALPHA", actions: [{ do: "hold", file: o.releaseFile }, result] },
        { when: "BETA", actions: [result] },
      ],
    });
    await service.start().settled;
    await service.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
    await service.call("settings.update", { patch: { keeper: { ceiling: 1 } } });
    for (const [name, marker] of [
      ["alpha", "ALPHA"],
      ["beta", "BETA"],
    ] as const) {
      const flow = FlowManifest.parse({
        format: "flowdriven-flow/1.1",
        id: `local.${name}`,
        name,
        kind: "build",
        steps: [
          {
            id: "a",
            do: "worker",
            instructions: `${marker} Say x`,
            outputs: [{ id: "draft", type: "text" }],
            checks: [{ type: "contains", pattern: "x" }],
          },
        ],
      });
      service.engine.registerFlow(flow, DEMO_HASH, {});
    }
    const a = service.engine.beginStart("local.alpha", { project: join(dataDir, "project") });
    const b = service.engine.beginStart("local.beta", { project: join(dataDir, "project") });
    let queue: QueueView | undefined;
    for (let turn = 0; turn < 200; turn++) {
      const current = QueueView.parse(await service.call("queue.list", {}));
      if (current.running === 1 && current.waiting === 1) {
        queue = current;
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const waiting = queue?.rows.find((row) => row.runId === b.run.id && row.state === "waiting")?.waiting;
    if (
      !queue ||
      waiting?.reason !== "ceiling" ||
      waiting.running === undefined ||
      waiting.ceiling === undefined ||
      !queue.rows.some((row) => row.runId === a.run.id && row.state === "running")
    )
      throw new Error("Expected ceiling queue was not reached");
    const detailA = RunDetail.parse(await service.call("runs.status", { runId: a.run.id }));
    const detailB = RunDetail.parse(await service.call("runs.status", { runId: b.run.id }));
    if (detailA.state !== "running" || detailB.state !== "running" || detailB.waiting?.reason !== "ceiling")
      throw new Error("Unexpected run states");
    const label = `Waiting: ${waiting.running} of ${waiting.ceiling} running`;
    const lines = [
      `ceiling 1: ${a.run.id} running, ${b.run.id} waiting: ${label}`,
      `queue: ${queue.running} step running, ${queue.waiting} waiting`,
      `${a.run.id} ${detailA.state}`,
      `${b.run.id} ${detailB.state}, waiting: ${detailB.waiting.reason}`,
    ];
    writeFileSync(o.releaseFile, "release");
    const [doneA, doneB] = await Promise.all([a.settled, b.settled]);
    if (doneA.state !== "done" || doneB.state !== "done") throw new Error("Demo runs did not finish");
    lines.push(`${doneA.id} ${doneA.state}, ${doneB.id} ${doneB.state}`);
    const final = RunDetail.parse(await service.call("runs.status", { runId: a.run.id }));
    for (const step of final.steps) {
      if (!step.usage?.reported) throw new Error("Step usage was not reported");
      const u = step.usage;
      lines.push(
        `usage ${step.stepId}: input ${u.input}, output ${u.output}, cache read ${u.cacheRead}, cache write ${u.cacheWrite}`,
      );
    }
    const exported = await service.call("runs.export", { runId: a.run.id });
    if (
      typeof exported !== "object" ||
      exported === null ||
      !("markdown" in exported) ||
      typeof exported.markdown !== "string"
    )
      throw new Error("Missing report");
    // The step table of the report also has a row for step a; the usage row is the one under "## Usage".
    const usageAt = exported.markdown.indexOf("\n## Usage\n");
    const row =
      usageAt < 0
        ? undefined
        : exported.markdown
            .slice(usageAt)
            .split("\n")
            .find((line) => line.startsWith("| a |"));
    if (!row) throw new Error("Missing usage row");
    lines.push(row);
    return lines;
  } finally {
    service.stop();
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
}
