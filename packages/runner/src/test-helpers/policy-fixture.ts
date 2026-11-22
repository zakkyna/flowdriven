import { buildPolicy, type Policy } from "../claude/policy.ts";
import type { RuleRow } from "../storage.ts";

export function makePolicy(
  input: Parameters<typeof buildPolicy>[0],
  overrides: Partial<Policy> = {},
): Policy {
  const defaults = (input.touches ?? [])
    .filter(
      (touch) =>
        ["read", "local_write", "run_command"].includes(touch.effect) && touch.rule !== "not_allowed",
    )
    .map((touch) => touch.id);
  const policy = buildPolicy({ ...input, onItsOwn: [...defaults, ...(input.onItsOwn ?? [])] });
  const rules = (policy.touches ?? [])
    .filter((touch) => touch.effect === "change" && touch.list === "on_its_own" && touch.place)
    .map((touch) => ruleOf(policy.flowId ?? "", touch.touchId, { place: touch.place }));
  return {
    ...policy,
    ...(input.touches === undefined ? {} : { rules }),
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
