import { demoScript } from "../demo/demo-script.ts";
import type { HarnessAdapter } from "../harness.ts";
import { scriptedHarness } from "../scripted-harness.ts";

export const DEMO_BATCHES: readonly [readonly string[], readonly string[]] = [
  ["j1", "j2", "j3", "j4"],
  ["j3", "j4", "j5"],
];
export function createDemoHarness(options: { runIndex: (runId: string) => number }): HarnessAdapter {
  const runs = new Map<string, HarnessAdapter>();
  return {
    id: "scripted",
    name: "Scripted harness",
    runStep(req) {
      let harness = runs.get(req.runId);
      if (!harness) {
        const batch = DEMO_BATCHES.at(options.runIndex(req.runId) % 2);
        if (!batch) throw new Error("Unknown demo run.");
        harness = scriptedHarness(demoScript([...batch]));
        runs.set(req.runId, harness);
      }
      return harness.runStep(req);
    },
    async replan() {
      return undefined;
    },
    async judge() {
      throw new Error("The demo harness has no judge.");
    },
    async probe() {
      throw new Error("The demo harness has no probe.");
    },
  };
}
