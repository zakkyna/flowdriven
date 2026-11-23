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

test("B-05.T15 email payload preserves bcc and attachment names", () => {
  const payload = { ...base.payload, bcc: ["b@example.com"], attachments: ["invoice.pdf"] };
  expect(Approval.parse({ ...base, payload }).payload).toEqual(payload);
});

test("B-05.T15 bcc is limited to 50 entries", () => {
  const payload = { ...base.payload, bcc: Array(50).fill("b@example.com") };
  expect(Approval.safeParse({ ...base, payload }).success).toBe(true);
  expect(Approval.safeParse({ ...base, payload: { ...payload, bcc: Array(51).fill("b") } }).success).toBe(
    false,
  );
  expect(Approval.safeParse({ ...base, payload: { ...payload, bcc: ["x".repeat(4001)] } }).success).toBe(
    false,
  );
});

test("B-05.T15 attachment names are limited to 4000 characters", () => {
  const payload = { ...base.payload, attachments: ["x".repeat(4000)] };
  expect(Approval.safeParse({ ...base, payload }).success).toBe(true);
  expect(
    Approval.safeParse({ ...base, payload: { ...payload, attachments: ["x".repeat(4001)] } }).success,
  ).toBe(false);
  expect(
    Approval.safeParse({ ...base, payload: { ...payload, attachments: Array(51).fill("x") } }).success,
  ).toBe(false);
});

test("B-05.T15 email payload without bcc or attachments still parses", () => {
  expect(Approval.parse(base).payload).toEqual(base.payload);
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
      place: { kind: "account", value: "a", label: "A" },
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
  expect(
    Approval.safeParse({
      ...a,
      effect: "change",
      riskyAction: undefined,
      state: "allowed_always",
      ruleId: "rule-000000000001",
    }).success,
  ).toBe(true);
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

const changeApproval = {
  ...base,
  riskyAction: undefined,
  effect: "change",
  fixedPlace: true,
  canAlwaysAllow: true,
};
const accountPlace = { kind: "account", value: "a", label: "A" };

test("TC-CON-13 always allow requires a safe fixed place", () => {
  expect(Approval.safeParse({ ...changeApproval, place: accountPlace }).success).toBe(true);
  for (const bad of [
    changeApproval,
    { ...changeApproval, place: { ...accountPlace, kind: "address" } },
    { ...changeApproval, place: accountPlace, outside: true },
  ])
    expect(Approval.safeParse(bad).success).toBe(false);
});
test("TC-CON-13 allowed always requires a change and rule", () => {
  const allowed = { ...changeApproval, canAlwaysAllow: false, state: "allowed_always", ruleId: "rule-1" };
  expect(Approval.safeParse(allowed).success).toBe(true);
  for (const bad of [
    { ...base, state: "allowed_always", ruleId: "rule-1" },
    { ...allowed, ruleId: undefined },
    { ...allowed, kind: "flow_sign_off" },
  ])
    expect(Approval.safeParse(bad).success).toBe(false);
});
test("TC-CON-35 edited subject requires edit", async () => {
  const { ApprovalsResolveInput } = await import("./approval.ts");
  expect(
    ApprovalsResolveInput.safeParse({ approvalId: "ap-1", decision: "approve", editedSubject: "x" }).success,
  ).toBe(false);
});
test("TC-CON-13 payload variants reject unknown keys and bound contents", async () => {
  const { Payload } = await import("./approval.ts");
  const variants = [
    { kind: "email", to: ["a"], subject: "s", body: "b" },
    { kind: "post", platform: "p", text: "t", media: [] },
    { kind: "diff", files: [{ path: "p", patch: "x" }] },
    { kind: "amount", amountUsd: 1, description: "d" },
    { kind: "text", text: "t" },
    { kind: "choice", question: "q", options: [{ key: "k", label: "l" }], maxPick: 1 },
  ];
  for (const payload of variants) {
    expect(Payload.safeParse(payload).success).toBe(true);
    expect(Payload.safeParse({ ...payload, extra: true }).success).toBe(false);
  }
  for (const payload of [
    { kind: "text", text: "x".repeat(4001) },
    { kind: "email", to: Array(51).fill("a"), subject: "s", body: "b" },
    { kind: "diff", files: [{ path: "p", patch: "x", extra: true }] },
    { kind: "choice", question: "q", options: [{ key: "k", label: "l", extra: true }], maxPick: 1 },
  ])
    expect(Payload.safeParse(payload).success).toBe(false);
});

test("TC-CON-44 decisions have no deadline", async () => {
  const { ResolvedVia } = await import("./approval.ts");
  const decision = base;
  const expiresAt = "2026-11-11T09:00:00.000Z";
  expect(Approval.safeParse(decision).success).toBe(true);
  expect(Approval.safeParse({ ...decision, expiresAt }).success).toBe(false);
  for (const via of ["window", "chat", "phone", "rule", "stop", "permission_off"])
    expect(ResolvedVia.safeParse(via).success).toBe(true);
  expect(ResolvedVia.safeParse("expiry").success).toBe(false);
});

test("TC-CON-45 outside decisions and another way", async () => {
  const { ApprovalsResolveInput, Line, operations } = await import("./index.ts");
  const outside = { ...base, kind: "outside_flow", editable: false };
  expect(Approval.safeParse(outside).success).toBe(true);
  expect(Approval.safeParse({ ...outside, effect: "read", riskyAction: undefined }).success).toBe(true);
  for (const bad of [
    { effect: undefined },
    { editable: true },
    { similarGroup: "g" },
    { similarWaiting: 1 },
    { riskyAction: undefined },
  ])
    expect(Approval.safeParse({ ...outside, ...bad }).success).toBe(false);
  const choice = { approvalId: "ap-1", decision: "another_way", anotherWayText: "x".repeat(4000) };
  expect(ApprovalsResolveInput.safeParse(choice).success).toBe(true);
  for (const text of [undefined, "", "x".repeat(4001), `x${String.fromCodePoint(0x200b)}`])
    expect(ApprovalsResolveInput.safeParse({ ...choice, anotherWayText: text }).success).toBe(false);
  expect(ApprovalsResolveInput.safeParse({ ...choice, decision: "approve" }).success).toBe(false);
  const answered = {
    ...outside,
    state: "another_way",
    anotherWayText: "try again",
    newTry: { key: "decision.newTry", params: { text: "x" } },
  };
  expect(Approval.safeParse(answered).success).toBe(true);
  for (const bad of [
    { anotherWayText: undefined },
    { state: "approved" },
    { kind: "flow_sign_off", riskyAction: undefined },
    { newTry: { key: "other.key", params: { text: "x" } } },
  ])
    expect(Approval.safeParse({ ...answered, ...bad }).success).toBe(false);
  for (const key of ["report.anotherWay", "decision.newTry", "report.didAnotherWay", "report.usedNote"]) {
    expect(Line.safeParse({ key, params: { text: "x".repeat(4000) } }).success).toBe(true);
    expect(Line.safeParse({ key, params: { text: "x".repeat(4001) } }).success).toBe(false);
    expect(Line.safeParse({ key, params: { other: "x".repeat(401) } }).success).toBe(false);
  }
  expect(Line.safeParse({ key: "report.approvedOnce", params: { title: "x".repeat(401) } }).success).toBe(
    false,
  );
  for (const reason of [
    "outside_flow_once",
    "another_way_not_allowed",
    "text_too_long",
    "empty_text",
    "hidden_characters",
  ])
    expect(operations["approvals.resolve"].reasons).toContain(reason);
  expect(operations["approvals.resolveSimilar"].reasons).toContain("outside_flow_once");
});
