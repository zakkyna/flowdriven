import { spawn } from "node:child_process";
import { childEnv } from "../claude/env.ts";
import { runCapture } from "../claude/run-capture.ts";
import type { Store } from "../storage.ts";
import { AGENT_CATALOG, type CatalogEntry } from "./catalog.ts";
import { loadModels } from "./models.ts";
import { type DetectionOptions, find, type RegistryOptions, signInStatus } from "./registry.ts";

type Child = {
  stderr: { on(event: "data", listener: (data: Buffer) => void): unknown } | null;
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: () => void): unknown;
  kill(): boolean;
};
type SpawnOptions = { shell: false; env: Record<string, string> };
export type SetupOptions = RegistryOptions & {
  spawnInstall?: (program: string, args: string[], options: SpawnOptions) => Child;
  spawnSignIn?: (program: string, args: string[], options: SpawnOptions) => unknown;
};
export function createAgentSetup(o: SetupOptions) {
  const catalog = o.catalog ?? AGENT_CATALOG;
  const active = new Map<string, { cancel?: () => void; child?: Child }>();
  const every =
    o.every ??
    ((ms: number, fn: () => void) => {
      const timer = setInterval(fn, ms);
      return () => clearInterval(timer);
    });
  const env = childEnv(o.env);
  const spawnInstall =
    o.spawnInstall ??
    ((program, args, opts) => spawn(program, args, { ...opts, stdio: ["ignore", "ignore", "pipe"] }));
  const spawnSignIn =
    o.spawnSignIn ??
    ((program, args, opts) => {
      const child = spawn(program, args, { ...opts, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    });
  const detection = (entry: CatalogEntry): DetectionOptions => ({
    env: o.env,
    cwd: o.cwd,
    home: o.home,
    extraDirs: o.extraDirs,
    explicit: entry.id === "claude-code" ? o.claudePath : o.codexPath,
    timeoutMs: o.timeoutMs,
    fs: o.fs,
  });
  const audit = (id: string, phase: string) =>
    o.store.appendAudit({ at: o.now().toISOString(), kind: "agent_setup", detail: { agentId: id, phase } });
  const state = (
    id: string,
    next: "installing" | "waiting_login" | "not_installed" | "ready" | "needs_login",
    extra: Partial<NonNullable<ReturnType<Store["getHarnessState"]>>> = {},
  ) => {
    o.store.putHarnessState({
      ...o.store.getHarnessState(id),
      id,
      state: next,
      stateAt: o.now().toISOString(),
      problem: undefined,
      ...extra,
    });
    o.markChanged?.();
  };
  const end = (id: string) => {
    active.get(id)?.cancel?.();
    active.delete(id);
  };
  function startSignIn(entry: CatalogEntry, path: string, version?: string) {
    const id = entry.id;
    const startedAt = o.now().getTime();
    state(id, "waiting_login", {
      setUp: {
        phase: "waiting_login",
        startedAt: new Date(startedAt).toISOString(),
        pollUntil: new Date(startedAt + 600000).toISOString(),
      },
    });
    audit(id, "waiting_login");
    try {
      spawnSignIn(entry.signIn.program, entry.signIn.args, { shell: false, env });
    } catch {
      /* Status remains authoritative. */
    }
    let polling = false;
    const cancel = every(2000, () => {
      if (o.now().getTime() >= startedAt + 600000) {
        state(id, "needs_login", {
          setUp: undefined,
          problem: { code: "sign_in_timeout", at: o.now().toISOString() },
        });
        audit(id, "sign_in_timeout");
        end(id);
        return;
      }
      if (polling) return;
      polling = true;
      void signInStatus(entry, path, detection(entry))
        .then(async (result) => {
          if (!active.has(id) || result.state !== "ready") return;
          const models = version
            ? { ...(await loadModels(entry, version, o)), at: o.now().toISOString() }
            : undefined;
          if (!active.has(id)) return;
          state(id, "ready", {
            setUp: undefined,
            billing: result.billing,
            ...(version ? { version } : {}),
            ...(models ? { models } : {}),
          });
          audit(id, "ready");
          end(id);
        })
        .finally(() => {
          polling = false;
        });
    });
    const current = active.get(id);
    if (current) current.cancel = cancel;
    else cancel();
  }
  async function afterInstall(entry: CatalogEntry) {
    const path = find(entry, detection(entry));
    if (!path) {
      fail(entry.id, "Agent executable not found.");
      return;
    }
    const versionResult = await runCapture(path, ["--version"], {
      env,
      cwd: o.cwd,
      timeoutMs: 14000,
      maxBytes: 262144,
    });
    if (!active.has(entry.id)) return;
    const version = /(?:^|\s)(\d+\.\d+\.\d+)/.exec(versionResult.stdout)?.[1];
    audit(entry.id, "installed");
    startSignIn(entry, path, version);
  }
  function fail(id: string, stderr: string) {
    if (!active.has(id)) return;
    const detail = stderr
      .split(/\r?\n/)[0]
      ?.replace(/\p{Cc}/gu, "")
      .replace(/(?:\/[^\s]+)+/g, "[path]")
      .slice(0, 120);
    state(id, "not_installed", {
      setUp: undefined,
      problem: { code: "install_failed", at: o.now().toISOString(), ...(detail ? { detail } : {}) },
    });
    audit(id, "install_failed");
    end(id);
  }
  return {
    startSignIn,
    async signIn(id: string) {
      const entry = catalog.find((item) => item.id === id);
      if (!entry) return { error: "agent_unknown" as const };
      const row = o.store.getHarnessState(id);
      if (active.has(id) || row?.state === "installing" || row?.state === "waiting_login")
        return { error: "setup_running" as const };
      const path = find(entry, detection(entry));
      if (!path || row?.state === "not_installed") return { error: "agent_not_installed" as const };
      active.set(id, {});
      o.store.appendAudit({
        at: o.now().toISOString(),
        kind: "agent_sign_in",
        detail: { agentId: id, result: "started" },
      });
      startSignIn(entry, path, row?.version);
      return {};
    },
    async setUp(id: string) {
      const entry = catalog.find((item) => item.id === id);
      if (!entry) return { error: "agent_unknown" as const };
      const row = o.store.getHarnessState(id);
      if (active.has(id) || row?.state === "installing" || row?.state === "waiting_login")
        return { error: "setup_running" as const };
      if (row?.state === "unknown") return { error: "agent_not_ready" as const };
      if ((!row || row.state === "not_installed") && !entry.install)
        return { error: "install_unavailable" as const };
      const before = o.store.getSetting("agentPermission") ?? "unset";
      if (before !== "on") {
        o.store.transaction(() => {
          o.store.appendAudit({
            at: o.now().toISOString(),
            kind: "permission_changed",
            detail: { from: before, to: "on", source: "window" },
          });
          o.store.putSetting("agentPermission", "on");
        });
      }
      if (row?.state === "ready") return {};
      active.set(id, {});
      if (row?.state === "needs_login") {
        const path = find(entry, detection(entry));
        if (path) startSignIn(entry, path, row.version);
        else fail(id, "Agent executable not found.");
        return {};
      }
      const startedAt = o.now().getTime();
      state(id, "installing", {
        setUp: {
          phase: "installing",
          startedAt: new Date(startedAt).toISOString(),
          pollUntil: new Date(startedAt + 600000).toISOString(),
        },
      });
      audit(id, "installing");
      const command = entry.install;
      if (!command) return {};
      try {
        const child = spawnInstall(command.program, command.args, { shell: false, env });
        const current = active.get(id);
        if (current) current.child = child;
        let stderr = "";
        child.stderr?.on("data", (data) => {
          if (stderr.length < 4096) stderr += data.toString().slice(0, 4096 - stderr.length);
        });
        child.on("error", () => fail(id, stderr));
        child.on("close", (code) => {
          if (!active.has(id)) return;
          active.get(id)?.cancel?.();
          if (code === 0) void afterInstall(entry).catch(() => fail(id, stderr));
          else fail(id, stderr);
        });
        const cancel = every(600000, () => {
          child.kill();
          fail(id, stderr);
        });
        if (current) current.cancel = cancel;
      } catch {
        fail(id, "");
      }
      return {};
    },
    stop() {
      for (const [id, current] of active) {
        active.delete(id);
        current.cancel?.();
        current.child?.kill();
      }
    },
  };
}
