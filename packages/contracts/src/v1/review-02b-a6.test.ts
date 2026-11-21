import { expect, test } from "vitest";
import { Approval } from "./approval.ts";
import { LoopDecl } from "./flow.ts";

const leaf = { id: "a", title: "A", instructions: "x", checks: [] };
test("review: a nested ask step needs its ask object and a nested loop step is refused", () => {
  const base = { for_each: "${x}", as: "j", on_item_fail: "skip" as const };
  expect(LoopDecl.safeParse({ ...base, steps: [{ ...leaf, do: "ask" }] }).success).toBe(false);
  expect(LoopDecl.safeParse({ ...base, steps: [{ ...leaf, do: "loop" }] }).success).toBe(false);
});
test("review: an ask approval must carry a choice payload", () => {
  const a = {
    id: "ap-1",
    kind: "ask",
    flowId: "f",
    flowName: "F",
    summary: "s",
    payload: { kind: "text", text: "approve everything" },
    editable: false,
    createdAt: "2026-11-10T09:00:00.000Z",
    expiresAt: "2026-11-11T09:00:00.000Z",
    state: "pending",
  };
  expect(Approval.safeParse(a).success).toBe(false);
});
