import { isAbsolute } from "node:path";
import { commandLineAllowed, parseCommandLine, type Value } from "@flowdriven/sdk";
import { digestCall } from "../connectors/grants.ts";
import { throwsMailAway } from "../connectors/label-rule.ts";
import type { HeldCall } from "../harness.ts";
import { EFFECTS, type Effect, effectOf } from "../rules/effects.ts";
import { matchRule } from "../rules/standing.ts";
import type { RuleRow } from "../storage.ts";
import { BROWSER_DENY, type BrowserState, CHROME_PREFIX, decideBrowser } from "./browser.ts";
import { decideCommand } from "./commands.ts";
import { type ConnectorAllow, type ConnectorState, decideConnector } from "./connector.ts";
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
  if (call.tool_name === "Bash" && policy.tools.includes("Bash")) {
    const result = decideCommand(policy.commands, call.tool_input);
    return result.allow ? { allow: true, tool } : deny(result.reason);
  }
  if (!policy.tools.includes(call.tool_name)) return deny(`This step does not declare the tool ${tool}.`);
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
  const containing = policy.folders.filter((folder) => isInside(folder.path, resolved));
  if (containing.length === 0) return deny(DENY.outside, target);
  const write = name === "Write" || name === "Edit";
  if (write && !containing.some((folder) => folder.write)) return deny(DENY.readOnly, target);
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
      by?: "read" | "declared_write" | "declared_command" | "rule";
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
type Books = { grants?: unknown; rules?: RuleRow[] | RuleBook };

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
  if (
    !base.allow &&
    !base.held &&
    !(
      external &&
      !connector &&
      (base.reason === DENY.badRequest || base.reason.startsWith("This step does not declare the tool "))
    )
  )
    return { ...base, outcome: "refuse" };
  if (name === "StructuredOutput" || name.startsWith(CHROME_PREFIX))
    return base.allow ? { ...base, outcome: "run" } : { ...base, outcome: "refuse" };
  let touch = policy.touches.find((item) => item.covers.includes(cover));
  let effect: Effect;
  let catalogPlace: { kind: "account"; value: string; label: string } | undefined;
  if (name === "Read" || name === "Glob" || name === "Grep") effect = "read";
  else if (name === "Write" || name === "Edit") effect = "local_write";
  else if (name === "Bash") {
    effect = "run_command";
    const parsed = typeof input.command === "string" ? parseCommandLine(input.command) : undefined;
    if (parsed?.ok)
      touch = policy.touches.find((item) =>
        item.covers.some((pattern) => commandLineAllowed([pattern], parsed.words)),
      );
  } else {
    const catalog = policy.effectCatalog ?? EFFECTS;
    const entry = catalog.find((item) => item.tool === name) ?? effectOf(cover, catalog);
    effect = entry.effect;
    if (entry.place?.kind === "account")
      catalogPlace = { ...entry.place, label: touch?.place?.label ?? entry.place.value };
    if (connector?.labelTools?.includes(connectorName) && throwsMailAway(input)) effect = "delete";
  }
  if ((effect === "local_write" || effect === "read") && !touch) {
    const path =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : policy.cwd;
    const resolved = resolveDeep(path);
    touch = policy.touches.find(
      (item) =>
        item.effect === effect &&
        item.place?.kind === "folder" &&
        resolved !== undefined &&
        isInside(item.place.value, resolved),
    );
  }
  if (touch?.list === "never") return refuse(`This step does not declare the tool ${visible(name, 60)}.`);
  if (external && !touch) return refuse(`This step does not declare the tool ${visible(name, 60)}.`);
  const allowed = (
    by: "read" | "declared_write" | "declared_command" | "rule",
    ruleId?: string,
  ): Decision => ({
    ...(base.allow ? base : { allow: true as const, tool: base.tool }),
    outcome: "run",
    effect,
    by,
    ...(ruleId ? { ruleId } : {}),
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
  if (effect === "read") return allowed("read");
  if ((effect === "local_write" || effect === "run_command") && (!touch || touch.list === "on_its_own"))
    return allowed(effect === "local_write" ? "declared_write" : "declared_command");
  const place = external ? catalogPlace : touch?.place;
  if (
    touch?.fixedPlace &&
    policy.flowId &&
    !policy.earlierNo &&
    policy.source !== "tool" &&
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
        touches: policy.touches.map((item) => ({ id: item.touchId, effect: item.effect, place: item.place })),
      },
    );
    if (rule) return allowed("rule", rule.id);
  }
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
    requirementId: connector?.requirementId ?? cover.split(".")[0] ?? "",
    tool: connectorName,
    input: copy,
    digest: digestCall(name, copy),
    effect,
    ...(action ? { action } : {}),
    ...(touch ? { touchId: touch.touchId } : {}),
    ...(place ? { place } : {}),
    fixedPlace:
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
