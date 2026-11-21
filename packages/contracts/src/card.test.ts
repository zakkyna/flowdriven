import { expect, test } from "vitest";
import * as c from "./index";

const hash = `sha256:${"a".repeat(64)}`;
const schedule = { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false };
const draft = {
  id: "draft-1",
  kind: "new_flow",
  state: "stale",
  name: "Flow",
  nameAdjusted: false,
  steps: [],
  inputs: [],
  result: "chat",
  schedule,
  lists: { onItsOwn: [], asksFirst: [], never: [] },
  outside: false,
  assumptions: [],
};
test("TC-CON-18 card action union", () => {
  const empty = [
    "start",
    "change_plan",
    "run",
    "not_now",
    "use_form",
    "use_last_answers",
    "cancel_question",
    "save_flow",
    "save_change",
    "cancel_change",
    "set_schedule",
    "skip_schedule",
    "turn_off_schedule",
    "keep_schedule",
    "stop_runs",
    "keep_running",
    "every_time",
    "only_this_time",
    "run_now",
    "propose_schedule",
    "retry_turn",
  ];
  const actions = [
    ...empty.map((action) => ({ action })),
    { action: "confirm_flow", values: { hash, onItsOwn: ["log-hours"] } },
    { action: "submit_form", values: { fields: { duration: "2 hours" } } },
    { action: "choose", values: { option: "example.build-apk" } },
    { action: "suggestion", values: { chip: 0 } },
    { action: "change_draft" },
    { action: "change_draft", values: { text: "x" } },
  ];
  for (const action of actions)
    expect(c.ChatAct.safeParse(action).success, JSON.stringify(action)).toBe(true);
  const bad = [
    { action: "confirm_flow" },
    {
      action: "submit_form",
      values: { fields: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, "x"])) },
    },
    { action: "submit_form", values: { fields: { a: "x".repeat(4001) } } },
    { action: "suggestion", values: { chip: -1 } },
    { action: "suggestion", values: { chip: 1.5 } },
    { action: "start", values: {} },
    ...["approve", "delete_flow", "use_other_agent"].map((action) => ({ action })),
  ];
  for (const action of bad) expect(c.ChatAct.safeParse(action).success, JSON.stringify(action)).toBe(false);
});
test("TC-CON-19 card types and states", () => {
  const base = { state: "open" };
  const named = { flowId: "f", name: "Flow" };
  const approval = {
    id: "ap-1",
    kind: "weekly_limit",
    canAlwaysAllow: false,
    stepWaiting: 0,
    summary: "Limit",
    payload: { kind: "text", text: "x" },
    editable: false,
    createdAt: "2026-11-19T02:00:00.000Z",
    expiresAt: "2026-11-20T02:00:00.000Z",
    state: "pending",
  };
  const cards = [
    {
      type: "plan",
      mode: "chain",
      items: [{ ...named, flowState: "new", values: [] }],
      agent: "codex",
      model: "model",
    },
    { type: "ask_run", ...named, values: [] },
    // biome-ignore lint/suspicious/noThenProperty: The contract names this field then.
    { type: "confirm", ...named, hash, then: "start" },
    { type: "inputs_ask", ...named, questionId: "wq-1", missing: [], known: [], canUseLast: false },
    { type: "form", ...named, questionId: "wq-1", fields: [] },
    { type: "runs", mode: "single", runs: [], notStarted: [] },
    { type: "decision", decision: approval },
    { type: "draft", draft },
    { type: "change", draft },
    { type: "schedule", ...named, schedule },
    { type: "unschedule", ...named, schedule },
    { type: "stop", runs: [] },
    { type: "status", needsYou: [], running: [], problems: [] },
    { type: "repeat_offer", ...named, afterFlowId: "f2", afterName: "Other" },
    { type: "run_offer", ...named, schedule },
    { type: "choose", purpose: "flow", options: [] },
    { type: "agent_needed", need: "permission" },
    { type: "turn_failed", forMessageId: "msg-1", failure: "timeout" },
  ];
  for (const card of cards) expect(c.CardView.safeParse({ ...base, ...card }).success, card.type).toBe(true);
  for (const state of ["open", "answered", "replaced", "cancelled", "stale", "flow_deleted", "closed"])
    expect(c.CardView.safeParse({ ...base, type: "agent_needed", need: "permission", state }).success).toBe(
      state !== "closed",
    );
  for (const type of ["banner", "other_agent"])
    expect(c.CardView.safeParse({ ...base, type }).success).toBe(false);
  expect(c.CardView.safeParse({ ...base, ...cards[0], items: [] }).success).toBe(false);
  for (const failure of [
    "not_understood",
    "no_usage",
    "spending_limit",
    "agent_failed",
    "timeout",
    "interrupted",
  ])
    expect(
      c.CardView.safeParse({ ...base, type: "turn_failed", forMessageId: "msg-1", failure }).success,
    ).toBe(true);
  expect(c.DraftView.safeParse(draft).success).toBe(true);
  for (const bad of [
    { ...draft, state: "deleted" },
    { ...draft, rulesKept: [] },
    { ...draft, rulesEnded: [] },
  ])
    expect(c.DraftView.safeParse(bad).success).toBe(false);
});
