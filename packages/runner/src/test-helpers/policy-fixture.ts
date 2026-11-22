import { buildPolicy, type Policy } from "../claude/policy.ts";
import type { RuleRow } from "../storage.ts";

export function makePolicy(
  input: Parameters<typeof buildPolicy>[0],
  overrides: Partial<Policy> = {},
): Policy {
  return {
    ...buildPolicy(input),
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
