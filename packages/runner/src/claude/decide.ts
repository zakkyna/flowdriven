import { isAbsolute } from "node:path";
import { commandLineAllowed, parseCommandLine, type Value } from "@flowdriven/sdk";
import { digestCall } from "../connectors/grants.ts";
import { throwsMailAway } from "../connectors/label-rule.ts";
import { asciiAddress } from "../exec/held.ts";
import type { HeldCall } from "../harness.ts";
import { matchGrant } from "../rules/decisions.ts";
import { EFFECT_RANK, EFFECTS, type Effect, effectOf } from "../rules/effects.ts";
import { matchRule } from "../rules/standing.ts";
import type { CallGrant, RuleRow, Store } from "../storage.ts";
import { BROWSER_DENY, type BrowserState, CHROME_PREFIX, decideBrowser } from "./browser.ts";
import { COMMAND_DENY, COMMAND_STOP, decideCommand } from "./commands.ts";
import {
  CONNECTOR_DENY,
  type ConnectorAllow,
  type ConnectorState,
  decideConnector,
  MAX_CONNECTOR_CALLS,
} from "./connector.ts";
import { hasParentPart, isInside, resolveDeep } from "./paths.ts";
import type { Policy } from "./policy.ts";
import { protectedPath } from "./protected.ts";
import { visible } from "./text.ts";

type LegacyDecision =
  | {
      allow: true;
      tool: string;
      target?: string;
      effect?: "page" | "tab" | "connector";
      connector?: ConnectorAllow;
    }
  | { allow: false; reason: string; tool: string; target?: string; held?: HeldCall };

export const DENY = {
  badRequest: "This request is not a tool call FlowDriven recognises.",
  otherSession: "This request belongs to another session.",
  noSchema: "This step did not ask for structured output.",
  noPath: "This call has no file path.",
  pathNotText: "This call has a path that is not text.",
  notAbsolute: "This path is not absolute.",
  badPath: "This path is not allowed.",
  outside: "This path is outside the folders this step declares.",
  readOnly: "This step may only read this folder.",
  pattern: "This pattern leaves the folder.",
  protectedPath: "This path is protected.",
};

function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function decideLegacy(
  policy: Policy,
  call: unknown,
  state?: BrowserState,
  connectorState?: ConnectorState,
): LegacyDecision {
  const tool = plain(call) && typeof call.tool_name === "string" ? visible(call.tool_name, 60) : "";
  const deny = (reason: string, target?: string): LegacyDecision => ({
    allow: false,
    reason,
    tool,
    ...(target === undefined ? {} : { target: target.slice(0, 300) }),
  });
  if (
    !plain(call) ||
    call.hook_event_name !== "PreToolUse" ||
    typeof call.tool_name !== "string" ||
    typeof call.tool_use_id !== "string" ||
    (!plain(call.tool_input) && !call.tool_name.startsWith(CHROME_PREFIX))
  )
    return deny(DENY.badRequest);
  if (call.session_id !== policy.sessionId) return deny(DENY.otherSession);
  if (call.tool_name === "StructuredOutput")
    return policy.schema ? { allow: true, tool } : deny(DENY.noSchema);
  if (call.tool_name.startsWith(CHROME_PREFIX)) {
    if (!policy.browser) return deny(`This step does not declare the tool ${tool}.`);
    if (!plain(call.tool_input)) return deny(BROWSER_DENY.part);
    const result = decideBrowser(
      policy.browser,
      call.tool_name.slice(CHROME_PREFIX.length),
      call.tool_input,
      state ?? { counts: { run: Infinity, day: Infinity }, tabs: new Set(), opened: Infinity },
    );
    return result.allow ? { ...result, tool } : deny(result.reason, result.target);
  }
  if (!plain(call.tool_input)) return deny(DENY.badRequest);
  if (policy.connector && call.tool_name.startsWith(policy.connector.prefix)) {
    const result = decideConnector(
      policy.connector,
      call.tool_name.slice(policy.connector.prefix.length),
      call.tool_input,
      connectorState ?? { calls: Infinity, granted: () => false },
    );
    return result.allow
      ? { allow: true, tool, effect: "connector", connector: result.connector }
      : { ...deny(result.reason), ...(result.held === undefined ? {} : { held: result.held }) };
  }
  // Bash goes through the command rule only in a step that declares commands; in any other step it
  // is refused below as an undeclared tool, with the same sentence as before.
  if (call.tool_name === "Bash" && (policy.tools.includes("Bash") || policy.touches !== undefined)) {
    if (policy.noCommands) return deny(COMMAND_STOP.outside);
    const result = decideCommand(
      policy.commands,
      call.tool_input,
      policy.touches === undefined
        ? undefined
        : { roots: policy.protectedRoots ?? [], projectRoot: policy.projectRoot },
    );
    return result.allow ? { allow: true, tool } : deny(result.reason);
  }
  if (
    !policy.tools.includes(call.tool_name) &&
    !(policy.touches !== undefined && ["Read", "Write", "Edit", "Glob", "Grep"].includes(call.tool_name))
  )
    return deny(`This step does not declare the tool ${tool}.`);
  const name = call.tool_name;
  if (!["Read", "Write", "Edit", "Glob", "Grep"].includes(name)) return deny(DENY.badRequest);
  const input = call.tool_input;
  const search = name === "Glob" || name === "Grep";
  const patternKey = name === "Glob" ? "pattern" : "glob";
  if (search && patternKey in input) {
    const pattern = input[patternKey];
    if (
      typeof pattern !== "string" ||
      pattern.includes("..") ||
      /[()]/.test(pattern) ||
      /\[[^\]]*\/[^\]]*\]/.test(pattern) ||
      pattern
        .split(/[{},]/)
        .some((part) => part.startsWith("/") || part.startsWith("\\") || part.startsWith("~"))
    )
      return deny(DENY.pattern);
  }
  const raw = search ? ("path" in input ? input.path : policy.cwd) : input.file_path;
  const target = search && !("path" in input) ? undefined : typeof raw === "string" ? raw : undefined;
  if (search && typeof raw !== "string") return deny(DENY.pathNotText);
  if (typeof raw !== "string" || (!search && raw === "")) return deny(DENY.noPath);
  if (!isAbsolute(raw)) return deny(DENY.notAbsolute, target);
  if (hasParentPart(raw)) return deny(DENY.badPath, target);
  const resolved = resolveDeep(raw);
  if (resolved === undefined) return deny(DENY.badPath, target);
  if (policy.touches !== undefined) {
    if (protectedPath(raw) || protectedPath(resolved)) return deny(DENY.protectedPath, target);
    if (policy.projectRoot && !isInside(policy.projectRoot, resolved)) return deny(DENY.outside, target);
    if (search && typeof input[patternKey] === "string") {
      const glob = input[patternKey] as string;
      if (
        glob.split("/").some((part) => /[*?[{]/.test(part) && /(?:^|[{,])\./.test(part)) ||
        glob.split(/[/{},]/).some(protectedPath)
      )
        return deny(DENY.protectedPath, target);
    }
  }
  const containing = policy.folders.filter((folder) => isInside(folder.path, resolved));
  if (
    containing.length === 0 &&
    !(policy.touches !== undefined && policy.projectRoot && isInside(policy.projectRoot, resolved))
  )
    return deny(DENY.outside, target);
  const write = name === "Write" || name === "Edit";
  if (write && !containing.some((folder) => folder.write) && policy.touches === undefined)
    return deny(DENY.readOnly, target);
  if (write && (protectedPath(raw) || protectedPath(resolved))) return deny(DENY.protectedPath, target);
  return { allow: true, tool, ...(target === undefined ? {} : { target: target.slice(0, 300) }) };
}

export type Held = Omit<HeldCall, "action"> & {
  action?: HeldCall["action"];
  effect: Effect;
  touchId?: string;
  place?: NonNullable<import("./policy.ts").CompiledTouch["place"]>;
  fixedPlace: boolean;
};
export type Decision =
  | {
      allow: true;
      outcome?: "run";
      tool: string;
      target?: string;
      effect?: Effect | "page" | "tab" | "connector";
      by?: "read" | "declared_write" | "declared_command" | "rule" | "grant";
      grant?: CallGrant;
      ruleId?: string;
      connector?: ConnectorAllow;
    }
  | {
      allow: false;
      outcome?: "hold" | "refuse";
      reason: string;
      tool: string;
      target?: string;
      effect?: Effect;
      held?: Held | HeldCall;
    };

export type RuleBook = {
  match(
    runId: string,
    flowId: string,
    touchId: string,
    effect: Effect,
    place: NonNullable<import("./policy.ts").CompiledTouch["place"]>,
  ): RuleRow | undefined;
};
type Books = { grants?: Pick<Store, "findGrant">; rules?: RuleRow[] | RuleBook; earlierNo?: () => boolean };

export function decide(
  policy: Policy,
  call: unknown,
  state?: BrowserState,
  connectorState?: ConnectorState,
  books?: Books,
): Decision {
  const base = decideLegacy(policy, call, state, connectorState);
  if (policy.touches === undefined) {
    if (base.allow) return { ...base, outcome: "run" };
    if (
      base.held &&
      policy.rejectedCalls?.some((row) => row.tool === base.held?.tool && row.digest === base.held?.digest)
    )
      return {
        allow: false,
        outcome: "refuse",
        tool: base.tool,
        reason: "You said no to this, so it was not done.",
      };
    return {
      ...base,
      outcome: base.held ? "hold" : "refuse",
      ...(base.held ? { effect: base.held.action } : {}),
    };
  }
  const refuse = (reason: string): Decision => ({ allow: false, outcome: "refuse", tool: base.tool, reason });
  if (
    !plain(call) ||
    call.hook_event_name !== "PreToolUse" ||
    typeof call.tool_name !== "string" ||
    typeof call.tool_use_id !== "string" ||
    call.session_id !== policy.sessionId ||
    !plain(call.tool_input)
  ) {
    return base.allow ? { ...base, outcome: "run" } : { ...base, outcome: "refuse" };
  }
  const name = call.tool_name;
  const input = call.tool_input;
  const declared = policy.declaredTools?.find((item) => item.tool === name);
  const connector =
    policy.connector && name.startsWith(policy.connector.prefix) ? policy.connector : undefined;
  const connectorName = connector ? name.slice(connector.prefix.length) : name;
  const fallbackCover = connector
    ? `${connector.requirementId}.${connectorName}`
    : name.includes("__")
      ? name.replace(/^mcp__/, "").replace("__", ".")
      : name;
  const cover = declared?.cover ?? fallbackCover;
  const external =
    declared !== undefined ||
    connector !== undefined ||
    (policy.tools.includes(name) && policy.touches.some((touch) => touch.covers.includes(cover)));
  try {
    const encoded = JSON.stringify(input);
    if (
      !encoded ||
      ((connector || !["Read", "Write", "Edit", "Glob", "Grep", "Bash"].includes(name)) &&
        Buffer.byteLength(encoded) > 16000)
    )
      return refuse(CONNECTOR_DENY.tooLarge);
  } catch {
    return refuse(CONNECTOR_DENY.tooLarge);
  }
  const exactGrant = () =>
    books?.grants && policy.runId && policy.stepId
      ? matchGrant(books.grants, {
          runId: policy.runId,
          stepId: policy.stepId,
          itemKey: policy.itemKey ?? "",
          tool: name,
          digest: digestCall(name, input as Value),
        })
      : undefined;
  if (name.startsWith(CHROME_PREFIX)) {
    if (base.allow) return { ...base, outcome: "run" };
    if (base.reason !== BROWSER_DENY.address || !policy.browser || typeof input.url !== "string")
      return { ...base, outcome: "refuse" };
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return { ...base, outcome: "refuse" };
    }
    const authority = /^https:\/\/([^/?#]*)/i.exec(input.url)?.[1];
    if (
      !authority ||
      authority.includes("@") ||
      /:\d*$/.test(authority) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !policy.browser.templates.some((template) => template.host === url.hostname)
    )
      return { ...base, outcome: "refuse" };
    const browserState = state ?? {
      counts: { run: Infinity, day: Infinity },
      tabs: new Set<number>(),
      opened: Infinity,
    };
    const grant = exactGrant();
    if (grant) {
      if (
        !Number.isSafeInteger(browserState.counts.run) ||
        browserState.counts.run < 0 ||
        browserState.counts.run >= policy.browser.perRun
      )
        return refuse(BROWSER_DENY.runLimit);
      if (
        !Number.isSafeInteger(browserState.counts.day) ||
        browserState.counts.day < 0 ||
        browserState.counts.day >= policy.browser.perDay
      )
        return refuse(BROWSER_DENY.dayLimit);
      return { allow: true, outcome: "run", tool: base.tool, effect: "page", by: "grant", grant };
    }
    if (
      policy.rejectedCalls?.some(
        (row) => row.tool === name && row.digest === digestCall(name, input as Value),
      )
    )
      return refuse("You said no to this, so it was not done.");
    const copy = JSON.parse(JSON.stringify(input)) as Value;
    return {
      allow: false,
      outcome: "hold",
      tool: base.tool,
      reason: "FlowDriven is holding this call until the owner approves it.",
      effect: "read",
      held: {
        requirementId: policy.browser.requirementId,
        tool: name,
        input: copy,
        digest: digestCall(name, copy),
        effect: "read",
        fixedPlace: false,
        outsideFlow: true,
      },
    };
  }
  if (name === "StructuredOutput")
    return base.allow ? { ...base, outcome: "run" } : { ...base, outcome: "refuse" };
  const undeclaredReason = !base.allow && base.reason.startsWith("This step does not declare the tool ");
  const commandOutside =
    name === "Bash" &&
    !base.allow &&
    base.reason !== COMMAND_DENY.badInput &&
    base.reason !== COMMAND_STOP.outside;
  if (
    !base.allow &&
    !base.held &&
    !undeclaredReason &&
    !commandOutside &&
    !((external || policy.tools.includes(name)) && base.reason === DENY.badRequest)
  )
    return { ...base, outcome: "refuse" };
  if (connector && (connectorState?.calls ?? Infinity) >= MAX_CONNECTOR_CALLS)
    return refuse(CONNECTOR_DENY.tooMany);
  const grant = exactGrant();
  let touch = policy.touches.find((item) => item.covers.includes(cover));
  let effect: Effect;
  let catalogPlace: NonNullable<import("./policy.ts").CompiledTouch["place"]> | undefined;
  let hiddenAddress = false;
  if (name === "Read" || name === "Glob" || name === "Grep") effect = "read";
  else if (name === "Write" || name === "Edit") effect = "local_write";
  else if (name === "Bash") {
    effect = "run_command";
    const parsed = typeof input.command === "string" ? parseCommandLine(input.command) : undefined;
    if (parsed?.ok) {
      const matches = policy.touches.filter((item) =>
        item.covers.some((pattern) => commandLineAllowed([pattern], parsed.words)),
      );
      const priority = { never: 0, asks_first: 1, on_its_own: 2 };
      matches.sort(
        (a, b) => priority[a.list] - priority[b.list] || EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect],
      );
      touch = matches[0];
      effect = matches.reduce<Effect>(
        (highest, item) => (EFFECT_RANK[item.effect] > EFFECT_RANK[highest] ? item.effect : highest),
        effect,
      );
    }
  } else {
    const catalog = policy.effectCatalog ?? EFFECTS;
    const entry = catalog.find((item) => item.tool === name) ?? effectOf(cover, catalog);
    effect = entry.effect;
    if (entry.place?.kind === "account")
      catalogPlace = { ...entry.place, label: touch?.place?.label ?? entry.place.value };
    if (entry.place?.kind === "folder") {
      const value = input[entry.place.fromInput];
      if (typeof value === "string") {
        hiddenAddress = visible(value, Infinity) !== value;
        catalogPlace = {
          kind: "folder",
          value: visible(value, Infinity),
          label: touch?.place?.label ?? "Folder",
        };
      }
    }
    if (entry.place?.kind === "address") {
      const addresses = entry.place.fromInput.flatMap((key) => {
        const value = input[key];
        return typeof value === "string"
          ? [value]
          : Array.isArray(value) && value.every((item) => typeof item === "string")
            ? (value as string[])
            : [];
      });
      hiddenAddress = addresses.some((address) => visible(address, Infinity) !== address);
      if (addresses.length)
        catalogPlace = {
          kind: "address",
          value: addresses
            .map((address) =>
              visible(address, Infinity) === address
                ? asciiAddress(address)
                : visible(address.toLowerCase(), Infinity),
            )
            .sort()
            .join(", "),
          label: touch?.place?.label ?? "Address",
        };
    }
    if (connector?.labelTools?.includes(connectorName) && throwsMailAway(input)) effect = "delete";
  }
  if (["Read", "Glob", "Grep", "Write", "Edit"].includes(name)) {
    const path =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : policy.cwd;
    const resolved = resolveDeep(path);
    const matches = policy.touches.filter(
      (item) =>
        item.effect === effect &&
        item.place?.kind === "folder" &&
        resolved !== undefined &&
        isInside(item.place.value, resolved),
    );
    if (matches.some((item) => item.list === "never")) touch = matches.find((item) => item.list === "never");
    matches.sort((a, b) => (b.place?.value.length ?? 0) - (a.place?.value.length ?? 0));
    touch =
      matches.find((item) => item.list === "never") ??
      matches.find((item) => item.list !== "on_its_own") ??
      matches[0];
  }
  const outsideFlow =
    touch?.list === "never" ||
    !touch ||
    commandOutside ||
    ((name === "Write" || name === "Edit") &&
      !policy.folders.some(
        (folder) => folder.write && isInside(folder.path, resolveDeep(String(input.file_path)) ?? ""),
      ));
  const allowed = (
    by: "read" | "declared_write" | "declared_command" | "rule" | "grant",
    ruleId?: string,
    grant?: CallGrant,
  ): Decision => ({
    ...(base.allow ? base : { allow: true as const, tool: base.tool }),
    outcome: "run",
    effect,
    by,
    ...(ruleId ? { ruleId } : {}),
    ...(grant ? { grant } : {}),
    ...(grant && base.allow && base.connector
      ? {
          connector: {
            requirementId: base.connector.requirementId,
            tool: base.connector.tool,
            class: base.connector.class,
          },
        }
      : {}),
    ...(connector && !base.allow
      ? {
          connector: {
            requirementId: connector.requirementId,
            tool: connectorName,
            class: effect === "read" ? ("read" as const) : ("write" as const),
          },
        }
      : {}),
  });
  if (grant) return allowed("grant", undefined, grant);
  if (effect === "read" && !outsideFlow) return allowed("read");
  const place = external ? catalogPlace : touch?.place;
  const findRule = () => {
    if (
      touch?.fixedPlace &&
      !policy.earlierNo &&
      !books?.earlierNo?.() &&
      !hiddenAddress &&
      policy.flowId &&
      ((touch.list === "on_its_own" && (effect === "local_write" || effect === "run_command")) ||
        (!policy.earlierNo && policy.source !== "tool" && policy.source !== "phone")) &&
      ((effect === "change" && (place?.kind === "account" || place?.kind === "folder")) ||
        (effect === "local_write" && place?.kind === "folder") ||
        (effect === "run_command" && place?.kind === "command"))
    ) {
      const book = books?.rules;
      const candidate =
        book && !Array.isArray(book)
          ? book.match(policy.runId ?? "", policy.flowId, touch.touchId, effect, place)
          : undefined;
      const rules = Array.isArray(book) ? book : book ? (candidate ? [candidate] : []) : (policy.rules ?? []);
      const rule = matchRule(
        rules,
        { flowId: policy.flowId, touchId: touch.touchId, effect, place },
        {
          hash: policy.hash,
          startedAt: policy.startedAt,
          touches: (policy.touches ?? []).map((item) => ({
            id: item.touchId,
            effect: item.effect,
            place: item.place,
          })),
        },
      );
      return rule;
    }
    return undefined;
  };
  const ownLocal = touch?.list === "on_its_own" && (effect === "local_write" || effect === "run_command");
  if (ownLocal && !outsideFlow) {
    const rule = findRule();
    if (rule) return allowed("rule", rule.id);
  }
  if (!outsideFlow && base.allow && base.connector?.grant?.kind === "pick") return allowed("grant");
  if (!ownLocal && !outsideFlow) {
    const rule = findRule();
    if (rule) return allowed("rule", rule.id);
  }
  if (
    policy.rejectedCalls?.some((row) => row.tool === name && row.digest === digestCall(name, input as Value))
  )
    return refuse("You said no to this, so it was not done.");
  let copy: Value;
  try {
    const encoded = JSON.stringify(input);
    if (!encoded || Buffer.byteLength(encoded) > 16000) return refuse("This connector call is too large.");
    copy = JSON.parse(encoded) as Value;
  } catch {
    return refuse("This connector call is too large.");
  }
  const action = ["send", "post", "pay", "delete", "merge"].includes(effect)
    ? (effect as HeldCall["action"])
    : undefined;
  const held: Held = {
    requirementId: connector?.requirementId ?? (name.startsWith("mcp__") ? cover.split(".")[0] : name) ?? "",
    ...(outsideFlow ? { outsideFlow: true as const } : {}),
    tool: name,
    input: copy,
    digest: digestCall(name, copy),
    effect,
    ...(action ? { action } : {}),
    ...(touch ? { touchId: touch.touchId } : {}),
    ...(place ? { place } : {}),
    fixedPlace:
      !hiddenAddress &&
      !!touch?.fixedPlace &&
      place !== undefined &&
      touch.place?.kind === place.kind &&
      touch.place.value === place.value,
  };
  return {
    allow: false,
    outcome: "hold",
    reason: "FlowDriven is holding this call until the owner approves it.",
    tool: base.tool,
    effect,
    held,
  };
}
