import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FlowManifest, parseManifest } from "@flowdriven/sdk";
import type { EngineDeps } from "../engine.ts";
import { type Script, scriptedHarness } from "../scripted-harness.ts";
import { localDay } from "../triggers/schedule.ts";
import { createTriggerService, type FloodEvent } from "../triggers/service.ts";
import { setup } from "./engine.ts";
import { oneStepFlow } from "./flows.ts";
import { tempPath } from "./tmp.ts";

export function triggerFlow(
  id: string,
  triggers: unknown[],
  extra: {
    limits?: { max_runs_per_day?: number; max_items?: number };
    inputs?: unknown[];
    steps?: unknown[];
  } = {},
): FlowManifest {
  const parsed = parseManifest({ ...oneStepFlow(id), triggers, ...extra });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
export function r4Flow(id: string): FlowManifest {
  const parsed = parseManifest({
    ...oneStepFlow(id),
    triggers: [{ kind: "schedule", every: "1h" }],
    requirements: [{ id: "mail", type: "mcp_server", ref: "mail", tools: ["SMSSend"] }],
    steps: [{ ...oneStepFlow(id).steps[0], uses: ["mail"] }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
export async function triggerRig(
  flows: { manifest: FlowManifest; files?: Record<string, string>; raw?: true }[],
  script: Script = { steps: { a: { text: "x", outputs: { draft: "x" } } } },
  options: {
    project?: string;
    readiness?: EngineDeps["readiness"];
    afterList?: () => void;
    hold?: { wait: () => Promise<void> };
    noWatch?: boolean;
  } = {},
) {
  let dayOf = localDay;
  const harness = scriptedHarness(script);
  if (options.hold) {
    const original = harness.runStep;
    const hold = options.hold;
    harness.runStep = async (request) => {
      await hold.wait();
      return original(request);
    };
  }
  const base = await setup(oneStepFlow("local.rig"), script, {
    harness,
    dayOf: (date) => dayOf(date),
    ...(options.readiness ? { readiness: options.readiness } : {}),
  });
  const { store, engine, clock } = base;
  const hashes = new Map<string, string>();
  flows.forEach((entry, i) => {
    const hash = `sha256:${String(i + 1).repeat(64)}`;
    hashes.set(entry.manifest.id, hash);
    if (entry.raw)
      store.putFlow({
        id: entry.manifest.id,
        version: entry.manifest.version,
        hash,
        manifest: entry.manifest,
        files: entry.files ?? {},
        registeredAt: clock.now().toISOString(),
      });
    else engine.registerFlow(entry.manifest, hash, entry.files);
  });
  const project = options.project ?? dirname(tempPath());
  const floods: FloodEvent[] = [];
  const jobs: (() => void)[] = [];
  const watchers = new Map<string, () => void>();
  const watchErrors = new Map<string, () => void>();
  const begun: ReturnType<typeof engine.beginStart>[] = [];
  const proxy = new Proxy(store, {
    get(target, key, receiver) {
      if (key === "listTriggers")
        return (flowId?: string) => {
          const rows = target.listTriggers(flowId);
          options.afterList?.();
          return rows;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const svc = createTriggerService({
    store: proxy,
    now: clock.now,
    dayOf: (date) => dayOf(date),
    projectDir: project,
    begin: (id, o) => {
      const result = engine.beginStart(id, o);
      begun.push(result);
      return result;
    },
    every: (_ms, fn) => {
      jobs.push(fn);
      return () => {
        const i = jobs.indexOf(fn);
        if (i >= 0) jobs.splice(i, 1);
      };
    },
    watch: (path, fn, onError) => {
      if (options.noWatch) return undefined;
      watchers.set(path, fn);
      watchErrors.set(path, onError);
      return () => {
        watchers.delete(path);
        watchErrors.delete(path);
      };
    },
    summaryOf: (t) => t.kind,
    onFlood: (event) => floods.push(event),
  });
  const hashOf = (id: string) => {
    const hash = hashes.get(id);
    if (!hash) throw new Error("missing hash");
    return hash;
  };
  let mtime = 100_000;
  return {
    watchError: () => {
      for (const fn of watchErrors.values()) fn();
    },
    signal: (path?: string) => {
      if (path) watchers.get(path)?.();
      else for (const fn of watchers.values()) fn();
    },
    writeFile: (rel: string, text = "x", mtimeMs?: number) => {
      const path = join(project, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      const time = mtimeMs ?? ++mtime;
      utimesSync(path, time / 1000, time / 1000);
    },
    svc,
    engine,
    store,
    clock,
    project,
    floods,
    jobs,
    watchers,
    hashOf,
    enable: (id: string, index: number) => svc.setEnabled(id, index, true, hashOf(id)),
    runsOf: (id: string) => store.listRuns({ flowId: id }),
    idle: async () => {
      await svc.settled();
      await Promise.all(begun.map((b) => b.settled));
    },
    setDay: (fn: (date: Date) => string) => {
      dayOf = fn;
    },
  };
}
