import { expect, test } from "vitest";
import { APPROVAL_EXPIRY_HOURS, Approval, approvalExpiresAt, RISKY_ACTIONS } from "./index";

const base = {
  id: "ap-1",
  kind: "risky_action",
  riskyAction: "send",
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
