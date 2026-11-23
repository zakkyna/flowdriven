import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  classifyCommand,
  parseTemplate,
  type Requirement,
  type Touch,
  type UrlTemplate,
  webRates,
} from "@flowdriven/sdk";
import { CONNECTORS, type ConnectorEntry, catalogEntry } from "../connectors/catalog.ts";
import { fold, isExtraRef, resolveExtraFolder } from "../folders/extra.ts";
import type { Routed } from "../router/types.ts";
import { EFFECT_RANK, EFFECTS, type Effect, type EffectEntry, effectOf } from "../rules/effects.ts";
import type { RuleRow } from "../storage.ts";
import type { BrowserPolicy } from "./browser.ts";
import { COMMAND_STOP, type CommandPolicy } from "./commands.ts";
import { CONNECTOR_STOP, type ConnectorPolicy } from "./connector.ts";
import type { ConnectorFact } from "./connector-scan.ts";
import { hasParentPart, isInside, resolveDeep } from "./paths.ts";
import { visible } from "./text.ts";

export type Folder = { path: string; write: boolean };
export type CompiledTouch = {
  touchId: string;
  effect: Effect;
  matcher: "folder" | "command" | "exact";
  place?: NonNullable<Touch["place"]>;
  fixedPlace: boolean;
  list: "on_its_own" | "asks_first" | "never";
  covers: string[];
};
export type Policy = {
  projectRoot?: string;
  protectedRoots?: string[];
  noCommands?: true;
  flowId?: string;
  hash?: string;
  startedAt?: string;
  touches?: CompiledTouch[];
  declaredTools?: { tool: string; cover: string }[];
  effectCatalog?: EffectEntry[];
  rules?: RuleRow[];
  runId?: string;
  stepId?: string;
  itemKey?: string;
  source?: string;
  earlierNo?: boolean;
  tools: string[];
  folders: Folder[];
  cwd: string;
  workFolder?: string;
  addDirs: string[];
  schema: boolean;
  sessionId: string;
  browser?: BrowserPolicy;
  connector?: ConnectorPolicy;
  commands?: CommandPolicy;
};

export function isProjectRef(ref: string | undefined): boolean {
  if (ref === undefined || ref === ".") return true;
  if (!ref || ref.startsWith("/") || ref.startsWith("\\") || ref.startsWith("~") || hasParentPart(ref))
    return false;
  for (const char of ref) {
    const point = char.codePointAt(0);
    if (point === undefined || point < 0x20 || point === 0x7f) return false;
  }
  return true;
}

export const ITEM_FOLDER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const FOLDER_STOP = {
  itemKey: (id: string) => `This step's item has no name that can be a folder (${id}).`,
  notGranted: (id: string) => `This step uses a folder you have not granted (${id}).`,
  moved: (id: string) => `The folder ${id} now leads somewhere else. Allow the flow again on its screen.`,
  project: (id: string) => `The folder ${id} holds this run's project folder.`,
};

export function buildPolicy(input: {
  kind: "worker" | "agent";
  flowId?: string;
  hash?: string;
  touches?: Touch[];
  onItsOwn?: string[];
  effectCatalog?: EffectEntry[];
  requirements: Requirement[];
  routes?: Routed[];
  connectors?: ConnectorFact[];
  catalog?: ConnectorEntry[];
  project: string;
  controlRoot: string;
  controlCwd: string;
  sessionId: string;
  schema: boolean;
  skillFolder?: string;
  takesOutside?: boolean;
  grantedFolders?: Record<string, { path: string; access: "read" | "read_write" }>;
  home?: string;
  itemKey?: string;
}): Policy {
  const policy: Policy = {
    tools: [],
    folders: [],
    cwd: input.controlCwd,
    addDirs: [],
    schema: input.schema,
    sessionId: input.sessionId,
  };
  if (input.touches !== undefined) {
    policy.projectRoot = resolveDeep(input.project);
    const root = resolveDeep(input.controlRoot);
    if (root) policy.protectedRoots = [root, dirname(root)];
    if (input.takesOutside === true) policy.noCommands = true;
    const catalog = input.effectCatalog ?? EFFECTS;
    policy.effectCatalog = catalog;
    policy.declaredTools = [];
    const declared = input.requirements.flatMap((req) => {
      if (req.type === "mcp_server") {
        const prefix = catalogEntry(req.ref, input.catalog ?? CONNECTORS)?.prefix ?? "";
        return (req.tools ?? []).map((tool) => {
          const cover = `${req.id}.${tool}`;
          const identity = prefix ? prefix + tool : `mcp__${req.id}__${tool}`;
          policy.declaredTools?.push({ tool: identity, cover });
          if (!prefix) policy.declaredTools?.push({ tool: cover, cover });
          return {
            cover: `${req.id}.${tool}`,
            entry: catalog.find((entry) => entry.tool === identity) ?? effectOf(cover, catalog),
            unknown: !catalog.some((entry) => entry.tool === identity || entry.tool === cover),
          };
        });
      }
      if (req.type === "cli_tool")
        return (req.commands ?? []).map((command) => ({
          cover: command,
          entry: {
            effect: classifyCommand(command) ?? ("run_command" as Effect),
            place: undefined,
            tool: command,
          },
          unknown: false,
        }));
      return [];
    });
    for (const item of declared) {
      const matches = input.touches.filter((touch) => touch.covers.includes(item.cover));
      const match = matches[0];
      if (
        matches.length !== 1 ||
        !match ||
        EFFECT_RANK[match.effect] < EFFECT_RANK[item.entry.effect] ||
        (EFFECT_RANK[item.entry.effect] === 3 && match.effect !== item.entry.effect)
      )
        throw new Error(`Invalid touch coverage: ${item.cover}`);
    }
    for (const touch of input.touches)
      for (const cover of touch.covers)
        if (!declared.some((item) => item.cover === cover))
          throw new Error(`Invalid touch coverage: ${cover}`);
    policy.flowId = input.flowId ?? "";
    policy.hash = input.hash ?? "";
    policy.touches = input.touches.map((touch) => {
      const unknown = declared.some((item) => touch.covers.includes(item.cover) && item.unknown);
      const place = unknown ? undefined : touch.place;
      return {
        touchId: touch.id,
        effect: touch.effect,
        matcher: place?.kind === "folder" ? "folder" : place?.kind === "command" ? "command" : "exact",
        ...(place ? { place } : {}),
        fixedPlace: place !== undefined,
        list:
          touch.rule === "not_allowed"
            ? "never"
            : input.onItsOwn?.includes(touch.id)
              ? "on_its_own"
              : "asks_first",
        covers: [...touch.covers],
      };
    });
  }
  if (input.kind === "agent") return policy;
  const commands = input.requirements.filter((r) => r.type === "cli_tool");
  if (
    commands.length &&
    (input.takesOutside !== false ||
      input.requirements.some((r) => r.type === "web" || r.type === "mcp_server" || r.sensitive))
  )
    throw new Error(COMMAND_STOP.outside);
  const paths = input.requirements.filter((requirement) => {
    if (requirement.type === "path") return true;
    if (requirement.type === "cli_tool") {
      const route = input.routes?.find((entry) => entry.requirementId === requirement.id);
      if (!route?.routed || route.provider !== "claude-code-commands" || !requirement.commands?.length)
        throw new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
      policy.commands ??= { patterns: [] };
      policy.commands.patterns.push(...requirement.commands);
      return false;
    }
    if (requirement.type === "harness" || requirement.type === "skill") return false;
    if (requirement.type === "web") {
      const fail = () =>
        new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
      const route = input.routes?.find((entry) => entry.requirementId === requirement.id);
      if (
        policy.browser ||
        policy.connector ||
        !route?.routed ||
        route.provider !== "claude-in-chrome" ||
        requirement.mode !== "read" ||
        requirement.session !== "own" ||
        !requirement.url_patterns?.length
      )
        throw fail();
      const templates: UrlTemplate[] = [];
      for (const source of requirement.url_patterns) {
        const parsed = parseTemplate(source);
        if (!parsed.ok || (requirement.domains && !requirement.domains.includes(parsed.template.host)))
          throw fail();
        templates.push(parsed.template);
      }
      policy.browser = { requirementId: requirement.id, templates, ...webRates(requirement) };
      return false;
    }
    if (requirement.type === "mcp_server") {
      const fail = () =>
        new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
      const entry = catalogEntry(requirement.ref, input.catalog ?? CONNECTORS);
      const route = input.routes?.find((item) => item.requirementId === requirement.id);
      if (
        !entry &&
        input.touches !== undefined &&
        (requirement.tools?.length ?? 0) > 0 &&
        (requirement.tools ?? []).every((tool) =>
          input.touches?.some((touch) => touch.covers.includes(`${requirement.id}.${tool}`)),
        )
      )
        return false;
      if (
        !entry ||
        (requirement.connect !== undefined && requirement.connect !== "native") ||
        policy.connector ||
        policy.browser ||
        !route?.routed ||
        route.provider !== "claude-ai-connector"
      )
        throw fail();
      const fact = input.connectors?.find((item) => item.name === entry.name && item.url === entry.url);
      if (!fact || fact.status !== "connected") throw new Error(CONNECTOR_STOP.down(entry.label));
      const tools = [...new Set(requirement.tools ?? [])];
      const read: string[] = [];
      const write: string[] = [];
      const risky: ConnectorPolicy["risky"] = {};
      for (const tool of tools) {
        const scanned = fact.tools.find((item) => item.name === tool);
        if (entry.read.includes(tool) && scanned?.readOnly === true) read.push(tool);
        else if (entry.write?.includes(tool) && scanned && scanned.destructive !== true) write.push(tool);
        else if (Object.hasOwn(entry.risky, tool) && scanned) {
          const action = entry.risky[tool];
          if (action === undefined) throw fail();
          Object.defineProperty(risky, tool, {
            value: action,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else throw fail();
      }
      policy.connector = {
        requirementId: requirement.id,
        label: entry.label,
        name: entry.name,
        url: entry.url,
        id: fact.id,
        prefix: entry.prefix,
        tools,
        read,
        ...(write.length
          ? { write, labelTools: (entry.labelTools ?? []).filter((tool) => write.includes(tool)) }
          : {}),
        risky,
        blocked: fact.tools.map((item) => item.name).filter((name) => !tools.includes(name)),
      };
      return false;
    }
    throw new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
  });

  const control = resolveDeep(input.controlRoot);
  for (const requirement of paths) {
    if (
      requirement.type === "path" &&
      requirement.per_item &&
      (!input.itemKey || !ITEM_FOLDER.test(input.itemKey))
    )
      throw new Error(FOLDER_STOP.itemKey(requirement.id));
  }
  const grantedPaths = new Map<string, string>();
  const pending: { path: string; ref: string | undefined; write: boolean }[] = [];
  for (const requirement of paths) {
    if (requirement.type !== "path") continue;
    if (requirement.access !== "read" && requirement.access !== "read_write") {
      throw new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
    }
    const ref = requirement.ref;
    const failure = () => new Error(`The folder ${visible(ref ?? ".", 60)} is not inside the project.`);
    if (isExtraRef(ref) && ref !== undefined && input.grantedFolders !== undefined) {
      const pin = Object.hasOwn(input.grantedFolders, requirement.id)
        ? input.grantedFolders[requirement.id]
        : undefined;
      if (!pin || pin.access !== requirement.access) throw new Error(FOLDER_STOP.notGranted(requirement.id));
      const resolve = () =>
        resolveExtraFolder(ref, { home: input.home ?? homedir(), dataDir: dirname(input.controlRoot) });
      const check = () => {
        const result = resolve();
        if (!result.ok || result.path !== pin.path) throw new Error(FOLDER_STOP.moved(requirement.id));
        const project = resolveDeep(input.project);
        if (!project) throw new Error(FOLDER_STOP.moved(requirement.id));
        if (isInside(fold(result.path), fold(project))) throw new Error(FOLDER_STOP.project(requirement.id));
        if (!control || isInside(result.path, control) || isInside(control, result.path))
          throw new Error("A folder of this step overlaps FlowDriven's control folder.");
        return result;
      };
      const before = check();
      try {
        mkdirSync(before.path, { recursive: true, mode: 0o700 });
      } catch {
        throw new Error(FOLDER_STOP.moved(requirement.id));
      }
      const after = check();
      if (!after.exists) throw new Error(FOLDER_STOP.moved(requirement.id));
      let path = after.path;
      if (requirement.per_item) {
        path = join(path, input.itemKey ?? "");
        try {
          try {
            mkdirSync(path, { mode: 0o700 });
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          }
          if (!lstatSync(path).isDirectory() || fold(realpathSync.native(path)) !== fold(path))
            throw new Error(FOLDER_STOP.moved(requirement.id));
        } catch {
          throw new Error(FOLDER_STOP.moved(requirement.id));
        }
      }
      grantedPaths.set(requirement.id, path);
      const existing = policy.folders.find((item) => item.path === path);
      if (existing) existing.write ||= requirement.access === "read_write";
      else policy.folders.push({ path, write: requirement.access === "read_write" });
      continue;
    }
    if (!isProjectRef(ref)) throw failure();
    let project: string;
    try {
      project = realpathSync.native(input.project);
    } catch {
      throw failure();
    }
    const folder = resolveDeep(ref === undefined || ref === "." ? input.project : join(input.project, ref));
    if (folder === undefined || !isInside(project, folder)) throw failure();
    if (control === undefined || isInside(folder, control) || isInside(control, folder))
      throw new Error("A folder of this step overlaps FlowDriven's control folder.");
    pending.push({ path: folder, ref, write: requirement.access === "read_write" });
  }
  for (const entry of pending) {
    const failure = () => new Error(`The folder ${visible(entry.ref ?? ".", 60)} is not inside the project.`);
    let folder: string;
    try {
      mkdirSync(entry.path, { recursive: true });
      folder = realpathSync.native(entry.path);
      const project = realpathSync.native(input.project);
      if (!isInside(project, folder)) throw failure();
      const resolvedControl = resolveDeep(input.controlRoot);
      if (
        resolvedControl === undefined ||
        isInside(folder, resolvedControl) ||
        isInside(resolvedControl, folder)
      )
        throw new Error("A folder of this step overlaps FlowDriven's control folder.");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "A folder of this step overlaps FlowDriven's control folder."
      )
        throw error;
      throw failure();
    }
    const existing = policy.folders.find((item) => item.path === folder);
    if (existing) existing.write ||= entry.write;
    else policy.folders.push({ path: folder, write: entry.write });
  }
  policy.folders.sort((a, b) => {
    const index = (path: string) =>
      paths.findIndex((req) => {
        if (req.type !== "path") return false;
        if (isExtraRef(req.ref)) return grantedPaths.get(req.id) === path;
        return (
          resolveDeep(
            req.ref === undefined || req.ref === "." ? input.project : join(input.project, req.ref),
          ) === path
        );
      });
    return index(a.path) - index(b.path);
  });
  for (const touch of policy.touches ?? []) {
    if (touch.place?.kind !== "folder" || touch.effect === "change") continue;
    const requirement = paths.find((item) => item.type === "path" && item.id === touch.place?.value);
    if (!requirement || requirement.type !== "path") throw new Error("Invalid touch folder");
    const resolved =
      grantedPaths.get(requirement.id) ??
      resolveDeep(
        requirement.ref === undefined || requirement.ref === "."
          ? input.project
          : join(input.project, requirement.ref),
      );
    if (!resolved || !policy.folders.some((folder) => folder.path === resolved))
      throw new Error("Invalid touch folder");
    touch.place = { ...touch.place, value: resolved };
  }
  // Compare resolved paths only: on macOS /var is a symlink to /private/var, so the unresolved
  // skill folder can differ from the entry pushed below.
  const skillPath = input.skillFolder === undefined ? undefined : resolveDeep(input.skillFolder);
  if (input.skillFolder !== undefined) {
    if (
      !skillPath ||
      policy.folders.some((entry) => isInside(entry.path, skillPath) || isInside(skillPath, entry.path))
    )
      throw new Error("The skill copy folder overlaps a folder of this step.");
    policy.folders.push({ path: skillPath, write: false });
  }
  const first = policy.folders.find((folder) => folder.path !== skillPath);
  if (first) {
    policy.cwd = first.path;
    if ([...grantedPaths.values()].includes(first.path)) policy.workFolder = first.path;
    policy.addDirs = policy.folders
      .filter((folder) => folder.path !== first.path)
      .map((folder) => folder.path);
    policy.tools = ["Read", "Glob", "Grep"];
    if (policy.folders.some((folder) => folder.write)) policy.tools.push("Write", "Edit");
  }
  if (policy.commands) {
    if (!first) throw new Error(COMMAND_STOP.noFolder);
    policy.tools.push("Bash");
  }
  if (skillPath && !first) {
    policy.addDirs = [skillPath];
    policy.tools = ["Read", "Glob", "Grep"];
  }
  return policy;
}
