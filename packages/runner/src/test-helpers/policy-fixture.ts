import type { Value } from "@flowdriven/sdk";
import { buildPolicy, type Policy } from "../claude/policy.ts";
import { digestCall } from "../connectors/grants.ts";
import type { CallGrant, RuleRow } from "../storage.ts";

export function makePolicy(
  input: Parameters<typeof buildPolicy>[0] & {
    extraTouches?: NonNullable<Parameters<typeof buildPolicy>[0]["touches"]>;
  },
  overrides: Partial<Policy> = {},
): Policy {
  const touches = input.extraTouches ? [...(input.touches ?? []), ...input.extraTouches] : input.touches;
  const defaults = (touches ?? [])
    .filter(
      (touch) =>
        ["read", "local_write", "run_command"].includes(touch.effect) && touch.rule !== "not_allowed",
    )
    .map((touch) => touch.id);
  const policy = buildPolicy({ ...input, touches, onItsOwn: [...defaults, ...(input.onItsOwn ?? [])] });
  const rules = (policy.touches ?? [])
    .filter(
      (touch) =>
        ["local_write", "run_command", "change"].includes(touch.effect) &&
        touch.list === "on_its_own" &&
        touch.place,
    )
    .map((touch) => ruleOf(policy.flowId ?? "", touch.touchId, { effect: touch.effect, place: touch.place }));
  return {
    ...policy,
    ...(touches === undefined ? {} : { rules }),
    runId: "run",
    stepId: "step",
    itemKey: "",
    source: "window",
    earlierNo: false,
    ...overrides,
  };
}
export function callOf(tool: string, input: unknown = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "session",
    tool_name: tool,
    tool_use_id: "call",
    tool_input: input,
  };
}

export function ruleOf(flowId: string, touchId: string, overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule",
    flowId,
    touchId,
    effect: "change",
    place: { kind: "account", value: "timesheet-account", label: "Timesheet" },
    state: "active",
    createdAt: "2026-11-22T00:00:00.000Z",
    createdBy: "confirm",
    sentence: "Log hours",
    uses: 0,
    ...overrides,
  };
}

export function legacyGrant(
  runId: string,
  stepId: string,
  itemKey: string,
  grant: string,
): import("../storage.ts").CallGrant {
  const i = grant.indexOf("#");
  return {
    runId,
    stepId: i < 0 ? "*" : stepId,
    itemKey,
    tool: i < 0 ? grant : grant.slice(0, i),
    digest: i < 0 ? "*" : grant.slice(i + 1),
    kind: i < 0 ? "pick" : "approve",
    createdAt: "2026-11-22T00:00:00.000Z",
  };
}

export function makeGrant(
  call: { tool: string; input: Value },
  overrides: Partial<CallGrant> = {},
): CallGrant {
  return {
    runId: "run",
    stepId: "step",
    itemKey: "",
    tool: call.tool,
    digest: digestCall(call.tool, call.input),
    kind: "approve",
    createdAt: "2026-11-22T00:00:00.000Z",
    ...overrides,
  };
}
