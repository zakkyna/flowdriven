import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Notice } from "@flowdriven/contracts";
import { CONTRACT_VERSION, operations, RunnerError, type RunnerTopic } from "@flowdriven/contracts";
import { AGENT_CATALOG } from "../agents/catalog.ts";
import { createAgentRegistry, type RegistryOptions } from "../agents/registry.ts";
import { createAgentSetup, type SetupOptions } from "../agents/setup.ts";
import { STOP } from "../claude/browser-post.ts";
import { visible } from "../claude/text.ts";
import { demoFlow } from "../demo/demo-flow.ts";
import { createEngine, type Engine } from "../engine.ts";
import { resolveExtraFolder } from "../folders/extra.ts";
import type { HarnessAdapter } from "../harness.ts";
import type { Probes } from "../keeper/types.ts";
import { routeAll } from "../router/route.ts";
import { bundledSkill, readSkillFolder, skillSource } from "../skills/skill-folder.ts";
import type { Store } from "../storage.ts";
import { localDay } from "../triggers/schedule.ts";
import type { TriggerDeps, TriggerService } from "../triggers/service.ts";
import { mapAgents } from "./agents.ts";
import { createAuditHandler } from "./audit.ts";
import { createCapabilities } from "./capabilities.ts";
import { createChatHandlers } from "./chats.ts";
import { createHarnessService } from "./claude-harness.ts";
import { prepareDataDir } from "./data-dir.ts";
import { createDemoHarness } from "./demo-harness.ts";
import { createFlowHandlers } from "./flows.ts";
import { createFlowDeleteHandler } from "./flows-delete.ts";
import { createFlowReadHandlers } from "./flows-import.ts";
import {
  type Caller,
  createDecisionHandlers,
  createDispatcher,
  createHandlers,
  createRuleHandlers,
  createSearchHandler,
  createSettingsHandlers,
} from "./handlers.ts";
import { createKeepAwake } from "./keep-awake.ts";
import { type Every, wireKeeper } from "./keeper-wiring.ts";
import { createNotifier, observeStore } from "./notify-wiring.ts";
import { commandReadiness } from "./readiness-commands.ts";
import { nativeHostPath } from "./readiness-web.ts";
import { createRunHandlers } from "./runs.ts";
import { wireTriggers } from "./trigger-wiring.ts";
import { createWeekly } from "./weekly-limit.ts";

export type ServiceOptions = {
  store: Store;
  languages?: readonly string[];
  /** Keeps the Mac awake during a long step; tests pass their own so no real caffeinate runs. */
  keepAwake?: (pid: number) => void;
  dataDir: string;
  mode: "demo" | "live";
  now?: () => Date;
  newId?: (prefix: string) => string;
  harness?: HarnessAdapter;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  webCheck?: () => { chromeFlag: boolean; hostFile: boolean };
  claudePath?: string;
  agents?: Partial<
    Pick<
      RegistryOptions,
      "home" | "extraDirs" | "claudePath" | "codexPath" | "timeoutMs" | "catalog" | "fs" | "every"
    >
  > &
    Pick<SetupOptions, "spawnInstall" | "spawnSignIn">;
  scanTimeoutMs?: number;
  keeper?: { probes?: Probes; every?: Every };
  markChanged?: (topic: RunnerTopic) => void;
  notify?: (notice: Notice) => void;
  clearNotice?: (id: string) => void;
  triggers?: { every?: Every; watch?: TriggerDeps["watch"]; dayOf?: (date: Date) => string };
};
export type RunnerService = {
  engine: Engine;
  call(name: string, input: unknown, caller?: Caller): Promise<unknown>;
  knows(name: string): boolean;
  start(): { settled: Promise<unknown> };
  stop(): void;
};
export const DEMO_HASH = `sha256:${"0".repeat(63)}1`;
export function createRunnerService(options: ServiceOptions): RunnerService {
  const { mode } = options;
  const now = options.now ?? (() => new Date());
  const dayOf = options.triggers?.dayOf ?? localDay;
  let triggers: TriggerService;
  const notifier = createNotifier({
    store: options.store,
    languages: options.languages,
    now,
    send: (notice) => options.notify?.(notice),
  });
  const store = observeStore(options.store, {
    onApproval: notifier.onApproval,
    onWeekly: notifier.onWeekly,
    onRunState: (id, state) => {
      let paused = false;
      if (mode === "live" && state === "blocked") {
        try {
          if (options.store.getRun(id)?.blockedReason === STOP.challenge) paused = triggers.pauseByRun(id);
        } catch {
          /* pausing is best effort */
        }
      }
      // A challenge that paused its trigger is told once, by the trigger-paused notice.
      if (!paused) notifier.onRunState(id, state);
      if (mode === "live" && (state === "done" || state === "failed" || state === "blocked")) triggers.poke();
    },
  });
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
          dayOf,
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
  const registry = createAgentRegistry({
    store,
    cwd: options.dataDir,
    env: options.env ?? process.env,
    now,
    claudePath: options.claudePath,
    ...options.agents,
    markChanged: () => options.markChanged?.("agents"),
  });
  const setup = createAgentSetup({
    store,
    cwd: options.dataDir,
    env: options.env ?? process.env,
    now,
    claudePath: options.claudePath,
    ...options.agents,
    markChanged: () => options.markChanged?.("agents"),
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
    dayOf,
    clearNotice: (id) => options.clearNotice?.(id),
    harness: wired?.harness ?? harness,
    keepAwake:
      options.keepAwake ??
      createKeepAwake({
        platform: process.platform,
        spawn: (cmd, args) => {
          const child = spawn(cmd, args, { stdio: "ignore" });
          child.unref();
          return child;
        },
        onError: () => store.appendAudit({ at: now().toISOString(), kind: "keep_awake_failed", detail: {} }),
      }),
    queue: wired?.keeper,
    ...(hs ? { routeOf: (reqs) => routeAll(reqs, hs.facts()) } : {}),
    readiness: hs
      ? hs.readiness
      : mode === "demo"
        ? () => ({ ready: true })
        : () => ({ ready: false, reason: "No harness is connected yet." }),
  });
  triggers = wireTriggers({
    store,
    engine,
    now,
    projectDir,
    home: homedir(),
    dataDir: options.dataDir,
    dayOf,
    every: options.triggers?.every,
    watch: options.triggers?.watch,
    onFlood: notifier.onFlood,
    onPaused: notifier.onPaused,
  });
  const handlers = createHandlers({
    engine,
    triggers,
    store,
    mode,
    projectDir,
    now,
    harnesses: hs,
    local: (row) => ({
      skill: (req) => {
        const source = skillSource(req.ref, { home: homedir() });
        if (!source) return { state: "missing", detail: "This skill's name is invalid." };
        if (source.kind === "installed") {
          try {
            lstatSync(source.dir);
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
              return { state: "missing", detail: `Your Claude Code has no skill ${source.name}.` };
          }
        }
        const result =
          source.kind === "installed"
            ? readSkillFolder(source.dir, source.name)
            : bundledSkill(row.files, source.name);
        return result.ok
          ? {
              state: "ok",
              detail: `Found your skill ${source.name}; its text has ${result.skill.copyText.length.toLocaleString("en-US")} characters.`,
            }
          : { state: "missing", detail: result.reason };
      },
      command: (req) => commandReadiness(req, { path: options.env?.PATH ?? "" }),
      folder: (req) => {
        const result = resolveExtraFolder(req.ref ?? "", { home: homedir(), dataDir: options.dataDir });
        if (!result.ok) return { state: "missing", detail: result.reason };
        const path = visible(result.path, 300);
        if (!result.exists) return { state: "ok", detail: `FlowDriven creates ${path} at the first run.` };
        try {
          if (!statSync(result.path).isDirectory()) throw new Error("not a folder");
        } catch {
          return { state: "missing", detail: "This path is not a folder." };
        }
        if (req.type === "path" && req.access === "read_write") {
          try {
            rmdirSync(mkdtempSync(join(result.path, ".flowdriven-check-")));
          } catch {
            return { state: "missing", detail: "This folder cannot be written." };
          }
        }
        return { state: "ok", detail: `Ready: ${path}.` };
      },
    }),
    ...(hs ? { connectors: () => hs.facts().connectors ?? [] } : {}),
    webCheck:
      options.webCheck ??
      (hs
        ? () => ({
            chromeFlag: hs.facts().chrome === true,
            hostFile: options.env?.HOME
              ? (options.exists ?? existsSync)(nativeHostPath(options.env.HOME))
              : false,
          })
        : undefined),
    capabilities: createCapabilities({
      home: homedir(),
      dataDir: options.dataDir,
      store,
      now,
      facts: () => hs?.facts() ?? { hooks: false, chrome: false },
    }),
    keeper: wired?.keeper,
    weekly,
    harnessIdOf: (name) =>
      name === "Scripted harness" ? "scripted" : name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
  });
  const decisions = createDecisionHandlers(store, engine, weekly, (id) => options.clearNotice?.(id));
  const settings = createSettingsHandlers(
    store,
    now,
    (id) => options.clearNotice?.(id),
    options.languages,
    engine,
  );
  const rules = createRuleHandlers(store, now);
  const runs = createRunHandlers(store, engine, (name) =>
    name === "Scripted harness" ? "scripted" : name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
  );
  const flowReads = createFlowReadHandlers(store, engine, now);
  const chats = createChatHandlers({
    store,
    registry,
    catalog: options.agents?.catalog ?? AGENT_CATALOG,
    languages: options.languages ?? ["en"],
    now,
    newId,
    markChanged: options.markChanged,
  });
  const appVersion = (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
  ).version;
  return {
    engine,
    call: createDispatcher({
      v2: {
        "chats.create": (input) => {
          const result = chats.create(input);
          options.markChanged?.("chats");
          return result;
        },
        "chats.get": (input) => chats.get(input),
        "chats.setAgent": async (input) => {
          const result = await chats.setAgent(input);
          options.markChanged?.("chats");
          return result;
        },
        "chats.delete": (input) => {
          const result = chats.delete(input);
          options.markChanged?.("chats");
          options.markChanged?.("activity");
          return result;
        },
        "agents.list": async () => mapAgents(await registry.list()),
        "agents.setUp": async ({ agentId }) => {
          await registry.list();
          const result = await setup.setUp(agentId);
          if (result.error) {
            if (result.error === "agent_not_ready")
              throw new RunnerError("not_allowed", "Agent is not ready.");
            const code =
              result.error === "agent_unknown"
                ? "not_found"
                : result.error === "setup_running"
                  ? "conflict"
                  : "unavailable";
            throw new RunnerError(code, "Agent setup unavailable.", { reason: result.error });
          }
          options.markChanged?.("settings");
          const agent = mapAgents(await registry.list()).find((item) => item.id === agentId);
          if (!agent) throw new RunnerError("not_found", "Agent not found.", { reason: "agent_unknown" });
          return agent;
        },
        "agents.signIn": async ({ agentId }) => {
          await registry.list();
          const result = await setup.signIn(agentId);
          if (result.error)
            throw new RunnerError(
              result.error === "agent_unknown"
                ? "not_found"
                : result.error === "setup_running"
                  ? "conflict"
                  : "not_allowed",
              "Agent sign-in unavailable.",
              { reason: result.error },
            );
          const agent = mapAgents(await registry.list()).find((item) => item.id === agentId);
          if (!agent) throw new RunnerError("not_found", "Agent not found.", { reason: "agent_unknown" });
          return agent;
        },
        "agents.models": async ({ agentId }) => {
          const result = await registry.models(agentId);
          if (result.error)
            throw new RunnerError(
              result.error === "agent_unknown" ? "not_found" : "not_allowed",
              "Agent models unavailable.",
              { reason: result.error },
            );
          return result.list;
        },
        "agents.rescan": async () => {
          const result = await registry.rescan();
          if (result.agents.some((agent) => agent.id === "claude-code" && agent.state === "ready"))
            await hs?.rescan();
          return { ...result, agents: mapAgents(result.agents) };
        },
        "flows.list": flowReads.list,
        "flows.get": flowReads.get,
        "flows.import": flowReads.import,
        "flows.confirm": createFlowHandlers(store, now).confirm,
        "flows.delete": (input) => {
          const result = createFlowDeleteHandler(store, engine, now)(input);
          for (const topic of ["flows", "rules", "runs", "approvals", "chats", "activity", "skills"] as const)
            options.markChanged?.(topic);
          return result;
        },
        "rules.list": rules.list,
        "rules.revoke": rules.revoke,
        "approvals.list": decisions.list,
        "approvals.resolve": decisions.resolve,
        "approvals.resolveSimilar": decisions.resolveSimilar,
        "approvals.answer": decisions.answer,
        "audit.list": createAuditHandler(store),
        "runs.list": runs.list,
        "runs.status": runs.status,
        "runs.report": runs.report,
        "runs.stop": (input) => {
          const result = runs.stop(input);
          if (result.changed)
            for (const topic of ["runs", "approvals", "chats", "activity"] as const)
              options.markChanged?.(topic);
          return result;
        },
        "settings.get": settings.get,
        "settings.update": async (input) => {
          if (input.patch.mainAgent) {
            const models = await registry.models(input.patch.mainAgent.agent);
            if (models.error)
              throw new RunnerError("not_allowed", "Agent is not ready.", { reason: "agent_not_ready" });
            if (!models.list.some((model) => model.id === input.patch.mainAgent?.model))
              throw new RunnerError("invalid_input", "Unknown model.", { reason: "model_unknown" });
          }
          return settings.update(input);
        },
        "search.query": createSearchHandler(store),
        "runner.info": () => ({
          contractVersion: CONTRACT_VERSION,
          appVersion,
          storeVersion: store.schemaVersion(),
          mode,
        }),
      },
      legacy: handlers,
      audit: (kind, detail) => {
        try {
          store.appendAudit({ at: now().toISOString(), kind, detail });
        } catch {}
      },
    }),
    knows: (name) => Object.hasOwn(operations, name),
    start() {
      prepareDataDir(projectDir);
      const settled = hs
        ? hs.start().settled.then(async () => {
            try {
              const recovery = engine.beginRecover();
              triggers.start();
              await recovery.settled;
            } catch {}
          })
        : (() => {
            const recovery = engine.beginRecover();
            if (mode === "live") triggers.start();
            return recovery.settled;
          })();
      if (mode === "demo") {
        const demo = demoFlow();
        engine.registerFlow(demo.manifest, DEMO_HASH, demo.files);
      }
      return { settled: Promise.all([settled, registry.list()]) };
    },
    stop: () => {
      triggers.stop();
      setup.stop();
      registry.stop();
      engine.shutdown();
      hs?.stop();
    },
  };
}
