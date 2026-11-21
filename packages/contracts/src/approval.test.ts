import { expect, test } from "vitest";
import { APPROVAL_EXPIRY_HOURS, Approval, approvalExpiresAt, RISKY_ACTIONS } from "./index";

const base = {
  id: "ap-1",
  kind: "risky_action",
  riskyAction: "send",
  effect: "send",
  canAlwaysAllow: false,
  stepWaiting: 0,
  flowId: "f",
  flowName: "F",
  summary: "Send a reply",
  payload: { kind: "email", to: ["a@example.com"], subject: "s", body: "b" },
  editable: true,
  createdAt: "2026-11-10T09:00:00.000Z",
  expiresAt: "2026-11-11T09:00:00.000Z",
  state: "pending",
};

test("risky actions are send, post, pay, delete and merge", () => {
  expect(RISKY_ACTIONS).toEqual(["send", "post", "pay", "delete", "merge"]);
});
test("approvals expire after 24 hours", () => {
  expect(APPROVAL_EXPIRY_HOURS).toBe(24);
  expect(approvalExpiresAt("2026-11-10T09:00:00.000Z")).toBe("2026-11-11T09:00:00.000Z");
});
test("a risky approval names its action and only then", () => {
  expect(Approval.safeParse(base).success).toBe(true);
  expect(Approval.safeParse({ ...base, riskyAction: undefined }).success).toBe(false);
  expect(Approval.safeParse({ ...base, kind: "flow_sign_off" }).success).toBe(false);
});
test("an approval keeps outside and is valid without it", () => {
  expect(Approval.parse({ ...base, outside: true }).outside).toBe(true);
  const plain = Approval.parse(base);
  expect(plain.outside).toBeUndefined();
});
test("outside must be a boolean", () => {
  expect(Approval.safeParse({ ...base, outside: "yes" }).success).toBe(false);
});
test("an email payload needs a recipient", () => {
  expect(Approval.safeParse({ ...base, payload: { ...base.payload, to: [] } }).success).toBe(false);
});

test("a choice approval carries its question, options and limit", () => {
  const payload = {
    kind: "choice",
    question: "Which jobs?",
    options: [{ key: "j1", label: "Job one" }],
    maxPick: 1,
  };
  const choice = { ...base, kind: "ask", riskyAction: undefined, payload };
  expect(Approval.safeParse(choice).success).toBe(true);
  expect(Approval.safeParse({ ...choice, payload: { ...payload, maxPick: 0 } }).success).toBe(false);
  expect(Approval.safeParse({ ...choice, payload: { ...payload, question: undefined } }).success).toBe(false);
});
test("an ask approval is not a risky action and may name an item and its picks", () => {
  const parsed = Approval.parse({
    ...base,
    kind: "ask",
    riskyAction: undefined,
    itemKey: "j1",
    picks: ["j1"],
    payload: {
      kind: "choice",
      question: "Which jobs?",
      options: [{ key: "j1", label: "Job one" }],
      maxPick: 1,
    },
  });
  expect(parsed.riskyAction).toBeUndefined();
  expect(parsed.itemKey).toBe("j1");
  expect(parsed.picks).toEqual(["j1"]);
});

const weekly = {
  id: "weekly-limit:claude-code",
  canAlwaysAllow: false,
  stepWaiting: 0,
  kind: "weekly_limit",
  summary: "Claude Code's weekly limit is 90% used and resets on Saturday. Keep running triggered flows?",
  payload: {
    kind: "text",
    text: "Claude Code's weekly limit is 90% used and resets on Saturday. Keep running triggered flows?",
  },
  editable: false,
  createdAt: "2026-11-11T09:00:00.000Z",
  expiresAt: "2026-11-14T09:00:00.000Z",
  state: "pending",
};
test("a weekly limit approval names no flow", () => {
  expect(Approval.parse(weekly).kind).toBe("weekly_limit");
  expect(Approval.safeParse({ ...weekly, runId: "r" }).success).toBe(false);
  expect(Approval.safeParse({ ...weekly, stepId: "s" }).success).toBe(false);
  expect(Approval.safeParse({ ...weekly, itemKey: "i" }).success).toBe(false);
  expect(
    Approval.safeParse({ ...weekly, payload: { kind: "amount", amountUsd: 1, description: "x" } }).success,
  ).toBe(false);
});
test("every other kind still names its flow", () => {
  expect(Approval.safeParse({ ...weekly, kind: "result_sign_off" }).success).toBe(false);
  expect(Approval.safeParse({ ...weekly, kind: "result_sign_off", flowId: "f" }).success).toBe(false);
  expect(Approval.safeParse({ ...weekly, kind: "result_sign_off", flowName: "F" }).success).toBe(false);
});

test("TC-CON-13 approval refinements", () => {
  const a = { ...base, effect: "send", canAlwaysAllow: false, stepWaiting: 0 };
  expect(Approval.safeParse(a).success).toBe(true);
  for (const bad of [
    { ...a, effect: undefined },
    { ...a, effect: "change" },
    { ...a, riskyAction: undefined },
    { ...a, kind: "ask" },
    { ...a, canAlwaysAllow: true, fixedPlace: true },
    { ...a, summary: "x".repeat(201) },
  ])
    expect(Approval.safeParse(bad).success).toBe(false);
  expect(
    Approval.safeParse({
      ...a,
      effect: "change",
      riskyAction: undefined,
      canAlwaysAllow: true,
      fixedPlace: true,
    }).success,
  ).toBe(true);
  expect(
    Approval.safeParse({
      ...a,
      effect: "change",
      riskyAction: undefined,
      canAlwaysAllow: true,
      fixedPlace: false,
    }).success,
  ).toBe(false);
  for (const effect of ["send", "post", "pay", "delete", "merge"])
    expect(
      Approval.safeParse({ ...a, effect, riskyAction: effect, canAlwaysAllow: true, fixedPlace: true })
        .success,
    ).toBe(false);
  for (const kind of ["weekly_limit", "budget_raise"]) {
    const global = { ...weekly, kind, canAlwaysAllow: false, stepWaiting: 0 };
    expect(Approval.safeParse(global).success).toBe(true);
    expect(Approval.safeParse({ ...global, runId: "r" }).success).toBe(false);
  }
  expect(Approval.safeParse({ ...a, state: "allowed_always", ruleId: "rule-000000000001" }).success).toBe(
    true,
  );
  for (const kind of ["flow_sign_off", "requirement_addition"]) {
    expect(
      Approval.safeParse({
        ...a,
        kind,
        riskyAction: undefined,
        effect: undefined,
        payload: { kind: "text", text: "Review" },
      }).success,
    ).toBe(true);
  }
  const choice = {
    ...a,
    kind: "ask",
    riskyAction: undefined,
    effect: undefined,
    payload: { kind: "choice", question: "Choose", options: [{ key: "a", label: "A" }], maxPick: 1 },
  };
  expect(Approval.safeParse(choice).success).toBe(true);
  expect(Approval.safeParse({ ...a, payload: choice.payload }).success).toBe(false);
});
test("TC-CON-35 approval operation inputs", async () => {
  const c = await import("./approval.ts");
  const id = "ap-000000000001";
  const resolve = { approvalId: id, decision: "edit", editedText: "x" };
  expect(c.ApprovalsResolveInput.safeParse(resolve).success).toBe(true);
  for (const bad of [
    { ...resolve, editedText: undefined },
    { ...resolve, decision: "approve" },
    { ...resolve, editedText: "" },
    { ...resolve, editedText: "x".repeat(4001) },
    { ...resolve, editedSubject: "x".repeat(301) },
  ])
    expect(c.ApprovalsResolveInput.safeParse(bad).success).toBe(false);
  expect(
    c.ApprovalsResolveInput.safeParse({
      ...resolve,
      editedText: "x".repeat(4000),
      editedSubject: "x".repeat(300),
    }).success,
  ).toBe(true);
  expect(c.ApprovalsResolveInput.safeParse({ approvalId: id, decision: "always_allow" }).success).toBe(true);
  expect(c.ApprovalsResolveInput.safeParse({ approvalId: id, decision: "approve_all" }).success).toBe(false);
  for (const picks of [[], Array(50).fill("x".repeat(100))])
    expect(c.ApprovalsAnswerInput.safeParse({ approvalId: id, picks }).success).toBe(true);
  for (const picks of [Array(51).fill("x"), ["x".repeat(101)]])
    expect(c.ApprovalsAnswerInput.safeParse({ approvalId: id, picks }).success).toBe(false);
  const batch = { runId: "run", group: "g", approvalIds: ["a", "b"] };
  expect(c.ApprovalsResolveSimilarInput.safeParse(batch).success).toBe(true);
  for (const approvalIds of [["a"], ["a", "a"], Array.from({ length: 51 }, (_, i) => `id${i}`)])
    expect(c.ApprovalsResolveSimilarInput.safeParse({ ...batch, approvalIds }).success).toBe(false);
  expect(c.ApprovalsResolveSimilarInput.safeParse({ ...batch, group: "x".repeat(101) }).success).toBe(false);
  expect(c.ApprovalsListInput.safeParse({ state: "pending" }).success).toBe(true);
  expect(c.ApprovalsListInput.safeParse({ state: "open" }).success).toBe(false);
});

test("TC-CON-35 rule operation inputs", async () => {
  const { RulesListInput, RulesRevokeInput } = await import("./index");
  expect(RulesListInput.safeParse({}).success).toBe(true);
  expect(RulesListInput.safeParse({ flowId: "example.build-apk" }).success).toBe(true);
  expect(RulesListInput.safeParse({ extra: true }).success).toBe(false);
  expect(RulesRevokeInput.safeParse({ ruleId: "rule-1" }).success).toBe(true);
  expect(RulesRevokeInput.safeParse({ ruleId: "bad id" }).success).toBe(false);
});
