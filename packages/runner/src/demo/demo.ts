import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine } from "../engine.ts";
import { renderRunReport } from "../report.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { demoFlow } from "./demo-flow.ts";
import { demoScript } from "./demo-script.ts";

export async function runDemo(options: {
  outDir: string;
  dbDir: string;
  now?: () => Date;
}): Promise<{ files: [string, string]; reports: [string, string] }> {
  mkdirSync(options.outDir, { recursive: true });
  mkdirSync(options.dbDir, { recursive: true });
  const { manifest, files: flowFiles } = demoFlow();
  async function run(ids: string[], pick: string): Promise<string> {
    const store = await openSqliteStore(
      join(options.dbDir, "demo.sqlite"),
      options.now ? { now: options.now } : {},
    );
    try {
      const harness = scriptedHarness(demoScript(ids));
      const engine = createEngine({ store, harness, ...(options.now ? { now: options.now } : {}) });
      engine.registerFlow(manifest, "demo", flowFiles);
      let result = await engine.startRun(manifest.id, { project: options.dbDir });
      const ask = engine.listApprovals({ runId: result.id, state: "pending" }).find((a) => a.kind === "ask");
      if (!ask) throw new Error("Demo choice missing.");
      result = await engine.answerAsk(ask.id, { picks: [pick] });
      const signoff = engine
        .listApprovals({ runId: result.id, state: "pending" })
        .find((a) => a.kind === "result_sign_off" && a.stepId === "proposal" && a.itemKey === pick);
      if (!signoff) throw new Error("Demo sign-off missing.");
      result = await engine.decide(signoff.id, "approve");
      if (result.state !== "done") throw new Error(`Demo run ${result.state}.`);
      return renderRunReport(engine.getRun(result.id));
    } finally {
      store.close();
    }
  }
  const reports: [string, string] = [
    await run(["j1", "j2", "j3", "j4"], "j1"),
    await run(["j3", "j4", "j5"], "j5"),
  ];
  const files: [string, string] = [join(options.outDir, "run-1.md"), join(options.outDir, "run-2.md")];
  writeFileSync(files[0], reports[0]);
  writeFileSync(files[1], reports[1]);
  return { files, reports };
}
