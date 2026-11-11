import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { operations } from "@flowdriven/contracts";
import { demoFlow } from "../demo/demo-flow.ts";
import { createEngine, type Engine } from "../engine.ts";
import type { HarnessAdapter } from "../harness.ts";
import type { Store } from "../storage.ts";
import { prepareDataDir } from "./data-dir.ts";
import { createDemoHarness } from "./demo-harness.ts";
import { createDispatcher, createHandlers } from "./handlers.ts";

export type ServiceOptions = {
  store: Store;
  dataDir: string;
  mode: "demo" | "live";
  now?: () => Date;
  newId?: (prefix: string) => string;
  harness?: HarnessAdapter;
};
export type RunnerService = {
  engine: Engine;
  call(name: string, input: unknown): Promise<unknown>;
  knows(name: string): boolean;
  start(): { settled: Promise<unknown> };
  stop(): void;
};
export const DEMO_HASH = `sha256:${"0".repeat(63)}1`;
export function createRunnerService(options: ServiceOptions): RunnerService {
  const { store, mode } = options;
  const now = options.now ?? (() => new Date());
  const projectDir = join(options.dataDir, mode === "demo" ? "demo-project" : "project");
  const noHarness = async (): Promise<never> => {
    throw new Error("No harness is connected yet.");
  };
  const harness =
    options.harness ??
    (mode === "demo"
      ? createDemoHarness({
          runIndex: (runId) =>
            store.listRuns({ flowId: store.getRun(runId)?.flowId }).findIndex((run) => run.id === runId),
        })
      : {
          id: "none",
          name: "No harness",
          runStep: noHarness,
          replan: noHarness,
          judge: noHarness,
          probe: noHarness,
        });
  const engine = createEngine({
    store,
    now,
    newId: options.newId ?? ((prefix) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`),
    harness,
    readiness:
      mode === "demo"
        ? () => ({ ready: true })
        : () => ({ ready: false, reason: "No harness is connected yet." }),
  });
  const handlers = createHandlers({
    engine,
    store,
    mode,
    projectDir,
    now,
    harnessIdOf: (name) =>
      name === "Scripted harness" ? "scripted" : name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
  });
  return {
    engine,
    call: createDispatcher(handlers, (kind, detail) => {
      try {
        store.appendAudit({ at: now().toISOString(), kind, detail });
      } catch {}
    }),
    knows: (name) => Object.hasOwn(operations, name),
    start() {
      prepareDataDir(projectDir);
      const { settled } = engine.beginRecover();
      if (mode === "demo") {
        const demo = demoFlow();
        engine.registerFlow(demo.manifest, DEMO_HASH, demo.files);
      }
      return { settled };
    },
    stop: () => engine.shutdown(),
  };
}
