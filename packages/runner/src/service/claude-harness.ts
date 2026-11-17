import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type HarnessCard, RunnerError } from "@flowdriven/contracts";
import type { FlowManifest, Requirement, Value } from "@flowdriven/sdk";
import { type ClaudeAdapterOptions, createClaudeAdapter } from "../claude/adapter.ts";
import type { ConnectorFact } from "../claude/connector-scan.ts";
import { controlRoot, sweepControlRoot } from "../claude/control.ts";
import { isSafeControlPath } from "../claude/hook-script.ts";
import { type InventoryEntry, readInventory } from "../claude/inventory.ts";
import { createPageCounter } from "../claude/pages.ts";
import { isProjectRef } from "../claude/policy.ts";
import { type ClaudeScan, scanClaude } from "../claude/scan.ts";
import { sweepSkillCopies } from "../claude/skill-step.ts";
import { catalogEntry } from "../connectors/catalog.ts";
import { createGrantBook } from "../connectors/grants.ts";
import { isExtraRef } from "../folders/extra.ts";
import type { HarnessAdapter } from "../harness.ts";
import {
  NOT_ENFORCED_UNATTENDED,
  routeAll,
  routeRequirement,
  unattendedProviderErrors,
} from "../router/route.ts";
import type { HarnessFacts, Routed } from "../router/types.ts";
import { bundledSkill, readSkillFolder, skillSource } from "../skills/skill-folder.ts";
import type { HarnessStateRow, Store } from "../storage.ts";
import { localDay } from "../triggers/schedule.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";

export const CLAUDE_ID = "claude-code";
export const ALLOW_FIRST = "Allow what this flow may touch on its screen first.";
export function harnessFacts(
  scan: ClaudeScan | undefined,
  connectors?: ConnectorFact[],
  skills?: string[],
): HarnessFacts {
  const facts: HarnessFacts =
    scan?.detected && scan.missingFlags.length === 0
      ? { hooks: true, chrome: scan.chrome === true }
      : { hooks: false, chrome: false };
  if (connectors !== undefined)
    facts.connectors = connectors.map(({ name, url, status, tools }) => ({ name, url, status, tools }));
  if (skills?.length) facts.skills = skills;
  return facts;
}
export function gateRoutes(
  manifest: FlowManifest,
  facts: HarnessFacts,
  route: (requirements: Requirement[], facts: HarnessFacts) => Routed[] = routeAll,
): string | undefined {
  return unattendedProviderErrors(manifest, route(manifest.requirements, facts)).length
    ? NOT_ENFORCED_UNATTENDED
    : undefined;
}
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
  skillChanged: (names: string[]) =>
    `Your skill ${names.join(", ")} changed since you allowed this flow. Look at it on the flow's screen and allow it again.`,
  sensitive: (ids: string[]) =>
    `This flow marks ${ids.join(", ")} as sensitive, and Claude Code runs without an OS sandbox. Allowing that arrives with a later version.`,
};
export type StoredScan = {
  scan: ClaudeScan;
  inventory: {
    skills: InventoryEntry[];
    plugins: InventoryEntry[];
    mcpServers: InventoryEntry[];
    connectors?: ConnectorFact[];
  };
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
export function gate(
  input: Parameters<typeof harnessGate>[0] & {
    manifest: FlowManifest;
    facts?: HarnessFacts;
    allowed?: boolean;
  },
): {
  ready: boolean;
  reason?: string;
} {
  const reason = harnessGate(input);
  if (reason !== undefined) return { ready: false, reason };
  const { manifest } = input;
  const facts = input.facts ?? { hooks: false, chrome: false };
  const drops = new Map<string, string>();
  let routedNeedsAllow = false;
  const cannot = new Set<string>(),
    sensitive = new Set<string>();
  for (const step of manifest.steps.flatMap((s) => ("steps" in s ? s.steps : [s]))) {
    for (const check of step.checks) if (check.type === "command") cannot.add(`command:${check.cmd}`);
    if (step.do !== "worker" && step.do !== "skill") continue;
    for (const id of new Set(step.do === "skill" ? [...step.uses, step.skill] : step.uses)) {
      const req = manifest.requirements.find((r) => r.id === id);
      if (
        req?.type === "web" ||
        (req?.type === "path" && isExtraRef(req.ref)) ||
        (req?.type === "cli_tool" && !!req.commands?.length) ||
        (req?.type === "mcp_server" && catalogEntry(req.ref)) ||
        (req?.type === "skill" && skillSource(req.ref, { home: "" }))
      ) {
        const route = routeRequirement(req, facts);
        if (!route || !route.routed) drops.set(id, route?.reason ?? "FlowDriven cannot provide this yet.");
        else {
          routedNeedsAllow = true;
          if (req.sensitive && input.allowed !== true) sensitive.add(id);
        }
        continue;
      }
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
  const firstDrop = [...drops.keys()].sort().at(0);
  if (firstDrop !== undefined) return { ready: false, reason: drops.get(firstDrop) };
  if (routedNeedsAllow && input.allowed !== true) return { ready: false, reason: ALLOW_FIRST };
  const routeReason = gateRoutes(manifest, facts);
  if (routeReason !== undefined) return { ready: false, reason: routeReason };
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
  const connectors = i.connectors;
  const valid =
    Array.isArray(connectors) &&
    connectors.length <= 40 &&
    connectors.every((c: unknown) => {
      if (!c || typeof c !== "object" || Array.isArray(c)) return false;
      const x = c as Record<string, unknown>;
      return (
        typeof x.name === "string" &&
        typeof x.url === "string" &&
        x.url.length <= 300 &&
        typeof x.id === "string" &&
        /^mcpsrv_[A-Za-z0-9]{1,60}$/.test(x.id) &&
        ["connected", "needs_login", "failed", "pending"].includes(String(x.status)) &&
        Array.isArray(x.tools) &&
        x.tools.length <= 200 &&
        x.tools.every(
          (t: unknown) =>
            !!t &&
            typeof t === "object" &&
            !Array.isArray(t) &&
            "name" in t &&
            typeof t.name === "string" &&
            "readOnly" in t &&
            typeof t.readOnly === "boolean",
        )
      );
    });
  if (connectors !== undefined && !valid) {
    const { connectors: _discard, ...rest } = i;
    return { scan: s, inventory: rest } as StoredScan;
  }
  return value as StoredScan;
}
export type HarnessService = {
  adapter: HarnessAdapter;
  start(): { settled: Promise<void> };
  list(): HarnessCard[];
  rescan(): Promise<HarnessCard[]>;
  setConsent(harnessId: string, consent: "given" | "revoked"): HarnessCard;
  facts(): HarnessFacts;
  readiness(
    manifest: FlowManifest,
    ctx?: { flowId: string; hash: string },
  ): { ready: boolean; reason?: string };
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
  dayOf?: (date: Date) => string;
  newId: (prefix: string) => string;
  scanTimeoutMs?: number;
  mcpTimeoutMs?: number;
  connectorSettleMs?: number;
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
                  connectorSettleMs: options.connectorSettleMs,
                })
              : { skills: [], plugins: [] };
          if (stopped) return;
          const next: StoredScan = {
            scan: result,
            inventory: {
              skills: inventory.skills,
              plugins: inventory.plugins,
              mcpServers: inventory.mcpServers ?? cache?.inventory.mcpServers ?? [],
              ...((inventory.connectors ?? cache?.inventory.connectors) !== undefined
                ? { connectors: inventory.connectors ?? cache?.inventory.connectors }
                : {}),
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
    copyRoot: join(options.dataDir, "skill-copies"),
    home: options.env.HOME ?? homedir(),
    grantedFolders: (runId) => {
      const run = options.store.getRun(runId);
      const consent = run && options.store.getCapabilityConsent(run.flowId);
      return run && consent?.hash === run.flowHash ? consent.pins?.folders : undefined;
    },
    skillPin: (runId, id) => {
      const run = options.store.getRun(runId);
      const consent = run && options.store.getCapabilityConsent(run.flowId);
      return run && consent?.hash === run.flowHash ? consent.pins?.skills[id] : undefined;
    },
    flowFiles: (runId) => {
      const run = options.store.getRun(runId);
      return (run && options.store.getFlow(run.flowId)?.files) ?? {};
    },
    audit: (kind, runId, detail) => {
      try {
        options.store.appendAudit({ at: options.now().toISOString(), kind, runId, detail });
      } catch {}
    },
    newId: options.newId,
    connectors: () => cache?.inventory.connectors ?? [],
    grants: createGrantBook(options.store),
    ...options.adapter,
    pages: createPageCounter({ store: options.store, dayOf: options.dayOf ?? localDay, now: options.now }),
    admit: (req) => {
      const folders = req.requirements.filter((r) => r.type === "path" && isExtraRef(r.ref));
      if (
        !folders.length &&
        !req.requirements.some((r) => r.type === "web" || (r.type === "mcp_server" && catalogEntry(r.ref)))
      )
        return undefined;
      const run = options.store.getRun(req.runId);
      const consent = run && options.store.getCapabilityConsent(run.flowId);
      if (!run || consent?.hash !== run.flowHash) return ALLOW_FIRST;
      if (folders.some((folder) => !Object.hasOwn(consent.pins?.folders ?? {}, folder.id)))
        return ALLOW_FIRST;
      return undefined;
    },
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
      sweepSkillCopies(join(options.dataDir, "skill-copies"));
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
    facts: () =>
      harnessFacts(
        cache?.scan,
        cache?.inventory.connectors,
        cache?.inventory.skills.filter((skill) => skill.scope === "user").map((skill) => skill.name),
      ),
    readiness(manifest, ctx) {
      const consent = ctx && options.store.getCapabilityConsent(ctx.flowId);
      const sameHash = ctx !== undefined && consent?.hash === ctx.hash;
      const used = new Set(
        manifest.steps.flatMap((step) =>
          ("steps" in step ? step.steps : [step]).flatMap((leaf) =>
            leaf.do === "skill" ? [...leaf.uses, leaf.skill] : leaf.do === "worker" ? leaf.uses : [],
          ),
        ),
      );
      const changed: string[] = [];
      if (sameHash && ctx) {
        for (const req of manifest.requirements) {
          if (req.type !== "skill" || !used.has(req.id)) continue;
          const source = skillSource(req.ref, { home: options.env.HOME ?? homedir() });
          if (!source) continue;
          const flow = source.kind === "bundled" ? options.store.getFlow(ctx.flowId) : undefined;
          const result =
            source.kind === "installed"
              ? readSkillFolder(source.dir, source.name)
              : flow && bundledSkill(flow.files, source.name);
          // The sentence names the skill, which the owner knows, not the flow's requirement id.
          if (!result || !result.ok || result.skill.hash !== consent?.pins?.skills[req.id])
            changed.push(source.name);
        }
      }
      const result = gate({
        platform: options.platform ?? process.platform,
        dataDir: options.dataDir,
        scan: cache?.scan,
        finished,
        fileExists: existsSync,
        consent: state()?.consent ?? "not_given",
        manifest,
        facts: harnessFacts(
          cache?.scan,
          cache?.inventory.connectors,
          cache?.inventory.skills.filter((skill) => skill.scope === "user").map((skill) => skill.name),
        ),
        allowed: sameHash && changed.length === 0,
      });
      return result.reason === ALLOW_FIRST && changed.length
        ? { ready: false, reason: GATE.skillChanged([...new Set(changed)].sort()) }
        : result;
    },
    stop() {
      stopped = true;
      adapter.stop?.();
    },
  };
}
