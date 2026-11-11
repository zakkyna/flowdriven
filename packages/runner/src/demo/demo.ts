import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine } from "../engine.ts";
import { renderRunReport } from "../report.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { demoFlow } from "./demo-flow.ts";

export async function runDemo(options: {
  outDir: string;
  dbDir: string;
  now?: () => Date;
}): Promise<{ files: [string, string]; reports: [string, string] }> {
  mkdirSync(options.outDir, { recursive: true });
  mkdirSync(options.dbDir, { recursive: true });
  const { manifest, files: flowFiles } = demoFlow();
  const titles: Record<string, string> = {
    j1: "Job one",
    j2: "Job two",
    j3: "Job three",
    j4: "Job four",
    j5: "Job five",
  };
  const scores: Record<string, number> = { j1: 9, j2: 4, j3: 8, j4: 6, j5: 8 };
  async function run(ids: string[], pick: string): Promise<string> {
    const store = await openSqliteStore(
      join(options.dbDir, "demo.sqlite"),
      options.now ? { now: options.now } : {},
    );
    try {
      const jobId = (instructions: string) => {
        const id = /"id":"(j\d)"/.exec(instructions)?.at(1);
        if (!id || !Object.hasOwn(titles, id)) throw new Error("Unknown demo job.");
        return id;
      };
      const harness = scriptedHarness({
        steps: {
          alerts: { outputs: { jobs: ids.map((id) => ({ id, title: titles[id] ?? "" })) }, text: "" },
          rough: (req) => {
            const id = jobId(req.instructions);
            const value = scores[id];
            if (value === undefined) throw new Error("Unknown score.");
            return { outputs: { score: { value } } };
          },
          page: (req) => ({ text: `Full post: ${titles[jobId(req.instructions)]}` }),
          full: (req) => ({
            outputs: { verdict: { fit: ["j1", "j3", "j5"].includes(jobId(req.instructions)) } },
          }),
          proto: (req) => ({ text: `Published at /p/${jobId(req.instructions)}` }),
          proposal: (req) => ({ text: `Hello, here is my plan for ${titles[jobId(req.instructions)]}.` }),
        },
      });
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
