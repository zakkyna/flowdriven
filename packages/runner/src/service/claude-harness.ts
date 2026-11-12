import { existsSync } from "node:fs";
import { type HarnessCard, RunnerError } from "@flowdriven/contracts";
import type { FlowManifest, Value } from "@flowdriven/sdk";
import { type ClaudeAdapterOptions, createClaudeAdapter } from "../claude/adapter.ts";
import { controlRoot, sweepControlRoot } from "../claude/control.ts";
import { isSafeControlPath } from "../claude/hook-script.ts";
import { type InventoryEntry, readInventory } from "../claude/inventory.ts";
import { isProjectRef } from "../claude/policy.ts";
import { type ClaudeScan, scanClaude } from "../claude/scan.ts";
import type { HarnessAdapter } from "../harness.ts";
import type { HarnessStateRow, Store } from "../storage.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";

export const CLAUDE_ID = "claude-code";
export const CONSENT_TEXT =
  "FlowDriven starts Claude Code on this Mac, and it works on the Claude plan you are signed in to. Anthropic's terms do not let other parties route requests through a plan login, while its help centre says that running Claude Code this way draws from your plan. So this route is gray: it could stop working, and Anthropic could limit your account. Each step gets only the tools and folders its flow declares, and FlowDriven checks every tool call before it runs. You can take this consent back at any time.";
export const GATE = {
  windows: "Running flows on Claude Code is not supported on Windows yet.",
  dataFolder: "FlowDriven cannot use a data folder whose path holds a quote mark or a line break.",
  looking: "FlowDriven is still looking for Claude Code. Try again in a moment.",
  notFound: "Claude Code was not found on this Mac. Install it, then scan again.",
  tooOld: "This version of Claude Code is too old for FlowDriven. Update it, then scan again.",
  signedOut: "Claude Code is signed out. Sign in to it, then scan again.",
  unknownLogin: "FlowDriven could not tell whether Claude Code is signed in. Scan again.",
  noConsent: "Give FlowDriven consent to run Claude Code on the Harnesses screen first.",
  cannotEnforce: (ids: string[]) =>
    `This flow needs something FlowDriven cannot enforce yet: ${ids.join(", ")}.`,
  sensitive: (ids: string[]) =>
    `This flow marks ${ids.join(", ")} as sensitive, and Claude Code runs without an OS sandbox. Allowing that arrives with a later version.`,
};
export type StoredScan = {
  scan: ClaudeScan;
  inventory: { skills: InventoryEntry[]; plugins: InventoryEntry[]; mcpServers: InventoryEntry[] };
};
export function harnessGate(input: {
  platform: string;
  dataDir: string;
  scan: ClaudeScan | undefined;
  finished: boolean;
  fileExists: (path: string) => boolean;
  consent: "not_given" | "given" | "revoked";
}): string | undefined {
  const { scan } = input;
  let reason: string | undefined;
  if (input.platform === "win32") reason = GATE.windows;
  else if (!isSafeControlPath(controlRoot(input.dataDir))) reason = GATE.dataFolder;
  else if (!input.finished || !scan) reason = GATE.looking;
  else if (!scan.detected || !scan.path || !input.fileExists(scan.path)) reason = GATE.notFound;
  else if (scan.missingFlags.length) reason = GATE.tooOld;
  else if (scan.login === "logged_out") reason = GATE.signedOut;
  else if (scan.login !== "logged_in") reason = GATE.unknownLogin;
  else if (input.consent !== "given") reason = GATE.noConsent;
  return reason;
}
export function gate(input: Parameters<typeof harnessGate>[0] & { manifest: FlowManifest }): {
  ready: boolean;
  reason?: string;
} {
  const reason = harnessGate(input);
  if (reason !== undefined) return { ready: false, reason };
  const { manifest } = input;
  const cannot = new Set<string>(),
    sensitive = new Set<string>();
  for (const step of manifest.steps.flatMap((s) => ("steps" in s ? s.steps : [s]))) {
    for (const check of step.checks) if (check.type === "command") cannot.add(`command:${check.cmd}`);
    if (step.do === "skill") {
      cannot.add(step.skill);
      for (const id of step.uses) cannot.add(id);
    }
    if (step.do !== "worker") continue;
    for (const id of step.uses) {
      const req = manifest.requirements.find((r) => r.id === id);
      if (
        !req ||
        !(
          (req.type === "path" && isProjectRef(req.ref)) ||
          (req.type === "harness" && (req.ref === undefined || req.ref === CLAUDE_ID))
        )
      )
        cannot.add(id);
      if (req?.sensitive) sensitive.add(id);
    }
  }
  if (cannot.size) return { ready: false, reason: GATE.cannotEnforce([...cannot].sort()) };
  if (sensitive.size) return { ready: false, reason: GATE.sensitive([...sensitive].sort()) };
  return { ready: true };
}
export function toHarnessCard(
  stored: StoredScan | undefined,
  state: HarnessStateRow | undefined,
): HarnessCard {
  const scan = stored?.scan;
  const detected = scan?.detected === true;
  return {
    id: CLAUDE_ID,
    name: "Claude Code",
    binary: "claude",
    detected,
    ...(detected && scan.version ? { version: scan.version } : {}),
    ...(detected && scan.path ? { path: scan.path } : {}),
    login: detected ? scan.login : "unknown",
    risk: "gray",
    riskNote: `Gray on a plan login, official with an API key.${scan?.missingFlags.length ? " This version is too old for FlowDriven." : ""}`,
    vendorProhibited: false,
    consent: state?.consent ?? "not_given",
    consentText: CONSENT_TEXT,
    sandbox: "none",
    adapter: "full",
    quota: { state: "unknown", today: { calls: 0 }, week: { calls: 0 } },
    inventory: {
      supported: detected,
      skills: stored?.inventory.skills ?? [],
      plugins: stored?.inventory.plugins ?? [],
      mcpServers: stored?.inventory.mcpServers ?? [],
    },
  };
}
export function storedScan(value: unknown): StoredScan | undefined {
  if (!value || typeof value !== "object" || !("scan" in value) || !("inventory" in value)) return undefined;
  const { scan, inventory } = value as { scan: unknown; inventory: unknown };
  if (!scan || typeof scan !== "object" || !inventory || typeof inventory !== "object") return undefined;
  const s = scan as Record<string, unknown>,
    i = inventory as Record<string, unknown>;
  if (
    typeof s.detected !== "boolean" ||
    ("chrome" in s && typeof s.chrome !== "boolean") ||
    (s.path !== undefined && typeof s.path !== "string") ||
    (s.version !== undefined && typeof s.version !== "string") ||
    !Array.isArray(s.missingFlags) ||
    !s.missingFlags.every((x: unknown) => typeof x === "string") ||
    typeof s.configFolder !== "boolean" ||
    !["logged_in", "logged_out", "unknown"].includes(String(s.login)) ||
    typeof s.scannedAt !== "string" ||
    (s.authMethod !== undefined && typeof s.authMethod !== "string")
  )
    return undefined;
  const entries = (v: unknown) =>
    Array.isArray(v) &&
    v.every(
      (x: unknown) =>
        !!x &&
        typeof x === "object" &&
        typeof (x as Record<string, unknown>).name === "string" &&
        ["user", "project"].includes(String((x as Record<string, unknown>).scope)) &&
        ((x as Record<string, unknown>).source === undefined ||
          typeof (x as Record<string, unknown>).source === "string") &&
        ((x as Record<string, unknown>).connection === undefined ||
          ["connected", "needs_login", "failed"].includes(String((x as Record<string, unknown>).connection))),
    );
  if (!entries(i.skills) || !entries(i.plugins) || !entries(i.mcpServers)) return undefined;
  return value as StoredScan;
}
export type HarnessService = {
  adapter: HarnessAdapter;
  start(): { settled: Promise<void> };
  list(): HarnessCard[];
  rescan(): Promise<HarnessCard[]>;
  setConsent(harnessId: string, consent: "given" | "revoked"): HarnessCard;
  readiness(manifest: FlowManifest): { ready: boolean; reason?: string };
  stop(): void;
};
export function createHarnessService(options: {
  store: Store;
  dataDir: string;
  projectDir: string;
  env: Record<string, string | undefined>;
  claudePath?: string;
  platform?: string;
  now: () => Date;
  newId: (prefix: string) => string;
  scanTimeoutMs?: number;
  mcpTimeoutMs?: number;
  adapter?: Partial<ClaudeAdapterOptions>;
}): HarnessService {
  let cache: StoredScan | undefined,
    finished = false,
    stopped = false;
  let queue: Promise<void> = Promise.resolve();
  const state = () => options.store.getHarnessState(CLAUDE_ID);
  const list = () => [toHarnessCard(cache, state())];
  const scan = (withMcp: boolean) => {
    queue = queue
      .then(async () => {
        try {
          const result = await scanClaude({
            explicit: options.claudePath,
            cwd: options.dataDir,
            env: options.env,
            now: options.now,
            timeoutMs: options.scanTimeoutMs,
          });
          const inventory =
            result.detected && result.path
              ? await readInventory({
                  claude: result.path,
                  cwd: options.dataDir,
                  env: options.env,
                  project: options.projectDir,
                  withMcp,
                  timeoutMs: options.scanTimeoutMs,
                  mcpTimeoutMs: options.mcpTimeoutMs,
                })
              : { skills: [], plugins: [] };
          if (stopped) return;
          const next: StoredScan = {
            scan: result,
            inventory: {
              skills: inventory.skills,
              plugins: inventory.plugins,
              mcpServers: inventory.mcpServers ?? cache?.inventory.mcpServers ?? [],
            },
          };
          options.store.putHarnessState({
            ...state(),
            id: CLAUDE_ID,
            consent: state()?.consent ?? "not_given",
            scan: next as Value,
            scanAt: result.scannedAt,
          });
          cache = next;
        } catch {
          cache = undefined;
        } finally {
          finished = true;
        }
      })
      .catch(() => {
        finished = true;
      });
    return queue;
  };
  const adapter = createClaudeAdapter({
    claudePath: () => (cache?.scan.detected ? cache.scan.path : undefined),
    env: () => options.env,
    controlRoot: controlRoot(options.dataDir),
    audit: (kind, runId, detail) => {
      try {
        options.store.appendAudit({ at: options.now().toISOString(), kind, runId, detail });
      } catch {}
    },
    newId: options.newId,
    ...options.adapter,
    effortModels: () => readKeeperSettings(options.store).effortModels["claude-code"],
    allowed: () =>
      harnessGate({
        platform: options.platform ?? process.platform,
        dataDir: options.dataDir,
        scan: cache?.scan,
        finished,
        fileExists: existsSync,
        consent: state()?.consent ?? "not_given",
      }),
  });
  return {
    adapter,
    start() {
      sweepControlRoot(controlRoot(options.dataDir));
      cache = storedScan(state()?.scan);
      return { settled: scan(false) };
    },
    list,
    async rescan() {
      await scan(true);
      return list();
    },
    setConsent(id, consent) {
      if (id !== CLAUDE_ID) throw new RunnerError("not_found", `There is no harness ${id}.`);
      if (consent === "given" && !cache?.scan.detected)
        throw new RunnerError("not_allowed", "This harness is not detected.");
      options.store.putHarnessState({
        ...state(),
        id: CLAUDE_ID,
        consent,
        consentAt: options.now().toISOString(),
      });
      if (consent === "revoked") adapter.interrupt(GATE.noConsent);
      options.store.appendAudit({
        at: options.now().toISOString(),
        kind: "harness_consent",
        detail: { harnessId: id, consent },
      });
      return list()[0] as HarnessCard;
    },
    readiness(manifest) {
      return gate({
        platform: options.platform ?? process.platform,
        dataDir: options.dataDir,
        scan: cache?.scan,
        finished,
        fileExists: existsSync,
        consent: state()?.consent ?? "not_given",
        manifest,
      });
    },
    stop() {
      stopped = true;
      adapter.stop?.();
    },
  };
}
