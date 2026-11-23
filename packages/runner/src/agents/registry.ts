import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { REQUIRED_FLAGS } from "../claude/args.ts";
import { childEnv } from "../claude/env.ts";
import { runCapture } from "../claude/run-capture.ts";
import type { Store } from "../storage.ts";
import { AGENT_CATALOG, type AgentId, type CatalogEntry } from "./catalog.ts";
import { loadModels } from "./models.ts";

export { AGENT_CATALOG } from "./catalog.ts";

export type AgentState =
  | "not_installed"
  | "needs_login"
  | "ready"
  | "unknown"
  | "installing"
  | "waiting_login";
export type Billing = "plan" | "per_use" | "unknown";
export type Detection = {
  state: AgentState;
  version?: string;
  billing: Billing;
  problem?: { code: "too_old" | "unreadable"; detail?: string };
};
export type DetectionOptions = {
  env: Record<string, string | undefined>;
  cwd: string;
  home?: string;
  extraDirs?: string[];
  explicit?: string;
  timeoutMs?: number;
  fs?: { statSync: typeof statSync; openSync?: typeof import("node:fs").openSync };
};
const defaults = (home?: string) => [
  ...(home && isAbsolute(home) ? [join(home, ".local/bin")] : []),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  ...(home && isAbsolute(home)
    ? [".claude/local", ".npm-global/bin", ".bun/bin"].map((dir) => join(home, dir))
    : []),
];
function find(entry: CatalogEntry, options: DetectionOptions): string | undefined {
  const dirs = [
    ...(options.env.PATH ?? "").split(":").filter(isAbsolute),
    ...(options.extraDirs ?? defaults(options.home ?? options.env.HOME)),
  ];
  const paths =
    options.explicit === undefined ? dirs.map((dir) => join(dir, entry.binary)) : [options.explicit];
  return paths.find((path) => {
    try {
      const stat = (options.fs?.statSync ?? statSync)(path);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });
}
function older(version: string, minimum: string) {
  const a = version.split(".").map(Number),
    b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
function capture(path: string, args: string[], options: DetectionOptions) {
  return runCapture(path, args, {
    env: childEnv(options.env),
    cwd: options.cwd,
    timeoutMs: Math.min(options.timeoutMs ?? 14000, 14000),
    maxBytes: 262144,
  });
}
export async function signInStatus(
  entry: CatalogEntry,
  path: string,
  options: DetectionOptions,
): Promise<Pick<Detection, "state" | "billing" | "problem">> {
  try {
    const status = await capture(path, entry.status.args, options);
    if (status.timedOut || status.truncated || (status.code !== 0 && status.code !== 1))
      return { state: "unknown", billing: "unknown", problem: { code: "unreadable" } };
    if (entry.id === "codex") {
      if (status.code !== 0 && status.code !== 1)
        return { state: "unknown", billing: "unknown", problem: { code: "unreadable" } };
      let method: unknown;
      try {
        const parsed: unknown = JSON.parse(status.stdout);
        if (parsed && typeof parsed === "object" && "authMethod" in parsed) method = parsed.authMethod;
      } catch {
        // Codex commonly reports status as plain text.
      }
      const billing: Billing =
        method === "subscription" || method === "claude.ai"
          ? "plan"
          : method === "api_key"
            ? "per_use"
            : "unknown";
      return { state: status.code === 0 ? "ready" : "needs_login", billing };
    }
    const parsed: unknown = JSON.parse(status.stdout);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("loggedIn" in parsed) ||
      typeof parsed.loggedIn !== "boolean"
    )
      throw new Error("unreadable");
    const method = "authMethod" in parsed ? parsed.authMethod : undefined;
    const billing: Billing =
      method === "subscription" || method === "claude.ai"
        ? "plan"
        : method === "api_key"
          ? "per_use"
          : "unknown";
    return { state: parsed.loggedIn ? "ready" : "needs_login", billing };
  } catch {
    return { state: "unknown", billing: "unknown", problem: { code: "unreadable" } };
  }
}
export async function detect(
  entry: CatalogEntry,
  options: DetectionOptions,
): Promise<Detection & { path?: string }> {
  const path = find(entry, options);
  if (!path) return { state: "not_installed", billing: "unknown" };
  try {
    const [versionResult, help, status] = await Promise.all([
      capture(path, ["--version"], options),
      capture(path, ["--help"], options),
      signInStatus(entry, path, options),
    ]);
    const version =
      versionResult.code === 0 && !versionResult.timedOut && !versionResult.truncated
        ? /(?:^|\s)(\d+\.\d+\.\d+)/.exec(versionResult.stdout)?.[1]
        : undefined;
    if (!version) return { path, state: "unknown", billing: "unknown", problem: { code: "unreadable" } };
    if (
      older(version, entry.lowestVersion) ||
      (entry.id === "claude-code" &&
        (help.code !== 0 ||
          help.timedOut ||
          help.truncated ||
          REQUIRED_FLAGS.some(
            (flag) => !new RegExp(`(?:^|[^a-zA-Z0-9-])${flag}(?![a-zA-Z0-9-])`).test(help.stdout),
          )))
    )
      return { path, version, state: "unknown", billing: "unknown", problem: { code: "too_old" } };
    return { path, version, ...status };
  } catch {
    return { path, state: "unknown", billing: "unknown", problem: { code: "unreadable" } };
  }
}
export type RegistryOptions = {
  store: Store;
  env: Record<string, string | undefined>;
  cwd: string;
  now: () => Date;
  home?: string;
  extraDirs?: string[];
  claudePath?: string;
  codexPath?: string;
  timeoutMs?: number;
  catalog?: CatalogEntry[];
  fs?: DetectionOptions["fs"];
  spawnInstall?: (program: string, args: string[]) => unknown;
  every?: (ms: number, fn: () => void) => () => void;
  markChanged?: () => void;
};
export function createAgentRegistry(options: RegistryOptions) {
  const catalog = options.catalog ?? AGENT_CATALOG;
  const known = new Map<AgentId, { path?: string; version?: string; tooOld?: boolean }>();
  let loaded = false,
    refreshedAt = 0,
    pending: Promise<void> | undefined,
    stopped = false;
  const opts = (entry: CatalogEntry): DetectionOptions => ({
    env: options.env,
    cwd: options.cwd,
    home: options.home,
    extraDirs: options.extraDirs,
    explicit: entry.id === "claude-code" ? options.claudePath : options.codexPath,
    timeoutMs: options.timeoutMs,
    fs: options.fs,
  });
  const refresh = (full: boolean): Promise<void> => {
    if (pending) return pending;
    pending = Promise.all(
      catalog.map(async (entry) => {
        const previous = known.get(entry.id);
        let result: Detection & { path?: string };
        if (!full && previous?.tooOld) return;
        if (!full && previous?.path && previous.version)
          result = { ...previous, ...(await signInStatus(entry, previous.path, opts(entry))) };
        else if (!full && previous) return;
        else result = await detect(entry, opts(entry));
        if (stopped) return;
        known.set(entry.id, {
          path: result.path,
          version: result.version,
          tooOld: result.problem?.code === "too_old",
        });
        const old = options.store.getHarnessState(entry.id);
        const models =
          result.state === "ready" && result.version
            ? !full && old?.models
              ? old.models
              : { ...(await loadModels(entry, result.version, options)), at: options.now().toISOString() }
            : undefined;
        options.store.putHarnessState({
          ...old,
          models,
          id: entry.id,
          state: result.state,
          stateAt: options.now().toISOString(),
          billing: result.billing,
          ...(result.version ? { version: result.version } : { version: undefined }),
          ...(result.problem
            ? { problem: { ...result.problem, at: options.now().toISOString() } }
            : { problem: undefined }),
        });
      }),
    )
      .then(() => {
        if (!stopped) {
          loaded = true;
          refreshedAt = options.now().getTime();
          options.markChanged?.();
        }
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  const cards = () =>
    catalog.map((entry) => {
      const row = options.store.getHarnessState(entry.id);
      const state = row?.state ?? "unknown";
      const canSetUp = state === "not_installed" || state === "needs_login" || state === "ready";
      return {
        id: entry.id,
        name: entry.name,
        maker: entry.maker,
        state,
        ...(row?.version ? { version: row.version } : {}),
        accountLine: { key: entry.accountKey },
        risk: entry.risk,
        riskNote: { key: entry.noteKey },
        canSetUp,
        ...(canSetUp ? { installCommand: [entry.install.program, ...entry.install.args].join(" ") } : {}),
        billing: row?.billing ?? "unknown",
        ...(state === "ready" && row?.models?.list.length
          ? { models: row.models.list, defaultModel: row.models.list.find((m) => m.isDefault)?.id }
          : {}),
        capability:
          entry.id === "codex"
            ? { tier: "label_only" as const, accountTools: false }
            : { tier: "enforced" as const, accountTools: true },
        ...(row?.problem
          ? {
              problem: {
                code: row.problem.code,
                ...(row.problem.detail ? { detail: row.problem.detail } : {}),
              },
            }
          : {}),
      };
    });
  return {
    async list() {
      if (!loaded) await refresh(true);
      else if (options.now().getTime() - refreshedAt >= 60000) void refresh(false);
      return cards();
    },
    async models(id: string) {
      if (!catalog.some((entry) => entry.id === id)) return { error: "agent_unknown" as const };
      if (!loaded) await refresh(true);
      const row = options.store.getHarnessState(id);
      if (row?.state !== "ready" || !row.models?.list.length) return { error: "agent_not_ready" as const };
      return { list: row.models.list };
    },
    async rescan() {
      if (pending) await pending;
      await refresh(true);
      return { agents: cards(), found: [] as AgentId[] };
    },
    stop() {
      stopped = true;
    },
  };
}
