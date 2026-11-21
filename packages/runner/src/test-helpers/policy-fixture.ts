import { buildPolicy, type Policy } from "../claude/policy.ts";

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
