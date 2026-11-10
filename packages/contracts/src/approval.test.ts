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
