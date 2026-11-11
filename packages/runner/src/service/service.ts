import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { operations, type RunnerTopic } from "@flowdriven/contracts";
import { demoFlow } from "../demo/demo-flow.ts";
import { createEngine, type Engine } from "../engine.ts";
import type { HarnessAdapter } from "../harness.ts";
import type { Probes } from "../keeper/types.ts";
import type { Store } from "../storage.ts";
import { createHarnessService } from "./claude-harness.ts";
import { prepareDataDir } from "./data-dir.ts";
import { createDemoHarness } from "./demo-harness.ts";
import { createDispatcher, createHandlers } from "./handlers.ts";
import { type Every, wireKeeper } from "./keeper-wiring.ts";
import { createWeekly } from "./weekly-limit.ts";

export type ServiceOptions = {
  store: Store;
  dataDir: string;
  mode: "demo" | "live";
  now?: () => Date;
  newId?: (prefix: string) => string;
  harness?: HarnessAdapter;
  env?: Record<string, string | undefined>;
  claudePath?: string;
  scanTimeoutMs?: number;
  keeper?: { probes?: Probes; every?: Every };
  markChanged?: (topic: RunnerTopic) => void;
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
  const newId =
    options.newId ?? ((prefix: string) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`);
  const hs =
    mode === "live" && !options.harness
      ? createHarnessService({
          store,
          dataDir: options.dataDir,
          projectDir,
          env: options.env ?? {},
          claudePath: options.claudePath,
          now,
          newId,
          scanTimeoutMs: options.scanTimeoutMs,
        })
      : undefined;
  const harness =
    options.harness ??
    hs?.adapter ??
    createDemoHarness({
      runIndex: (runId) =>
        store.listRuns({ flowId: store.getRun(runId)?.flowId }).findIndex((run) => run.id === runId),
    });
  const weekly = createWeekly({ store, now, recheck: () => wired?.keeper.recheck() });
  const wired =
    mode === "live"
      ? wireKeeper({ store, now, harness, ...options.keeper, weekly, markChanged: options.markChanged })
      : undefined;
  const engine = createEngine({
    store,
    now,
    newId,
    harness: wired?.harness ?? harness,
    queue: wired?.keeper,
    readiness: hs
      ? hs.readiness
      : mode === "demo"
        ? () => ({ ready: true })
        : () => ({ ready: false, reason: "No harness is connected yet." }),
  });
  const handlers = createHandlers({
    engine,
    store,
    mode,
    projectDir,
    now,
    harnesses: hs,
    keeper: wired?.keeper,
    weekly,
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
      const settled = hs
        ? hs.start().settled.then(async () => {
            try {
              await engine.beginRecover().settled;
            } catch {}
          })
        : engine.beginRecover().settled;
      if (mode === "demo") {
        const demo = demoFlow();
        engine.registerFlow(demo.manifest, DEMO_HASH, demo.files);
      }
      return { settled };
    },
    stop: () => {
      engine.shutdown();
      hs?.stop();
    },
  };
}
