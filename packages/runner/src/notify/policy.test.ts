import { expect, test } from "vitest";
import { createNoticePolicy } from "./policy.ts";

const setup = () => {
  const clock = { now: Date.parse("2026-11-12T00:00:00Z") };
  return { clock, policy: createNoticePolicy({ nowMs: () => clock.now }) };
};
const approval = (approvalId: string) => ({
  kind: "approval_waiting" as const,
  runId: "run-1",
  approvalId,
  flowName: "Flow",
});
const blocked = (runId: string) => ({
  kind: "run_blocked" as const,
  runId,
  flowId: "flow-1",
  flowName: "Flow",
});

test("an approval notifies once, a second approval of the same run notifies too, and the same approval never twice", () => {
  const { policy } = setup();
  expect(policy.decide(approval("a1"))).toEqual({
    id: "approval:a1",
    kind: "approval_waiting",
    title: "Waiting for you",
    body: "Flow: an approval is waiting.",
    target: { screen: "inbox", approvalId: "a1" },
  });
  expect(policy.decide(approval("a2"))?.id).toBe("approval:a2");
  expect(policy.decide(approval("a1"))).toBeUndefined();
});

test("a blocked run notifies once and not again within 10 minutes; the same flow blocking again within 6 hours says nothing; after 6 hours it notifies", () => {
  const { policy, clock } = setup();
  expect(policy.decide(blocked("r1"))).toEqual({
    id: "blocked:r1",
    kind: "run_blocked",
    title: "Run blocked",
    body: "Flow is blocked and needs a look.",
    target: { screen: "run", runId: "r1" },
  });
  clock.now += 600_000 - 1;
  expect(policy.decide(blocked("r1"))).toBeUndefined();
  expect(policy.decide(blocked("r2"))).toBeUndefined();
  clock.now += 21_600_000 - 600_000 + 1;
  expect(policy.decide(blocked("r2"))?.id).toBe("blocked:r2");
});

test("a waiting approval is not held back by the 10 minute throttle after a block", () => {
  const { policy } = setup();
  expect(policy.decide(blocked("run-1"))).toBeDefined();
  expect(policy.decide(approval("a1"))).toBeDefined();
});

test("the weekly limit notifies once per harness per 24 hours, names the weekday, ignores a reset time that jitters inside 24 hours, and notifies again after 24 hours", () => {
  const { policy, clock } = setup();
  const event = {
    kind: "weekly_limit" as const,
    harnessId: "claude-code",
    percent: 95,
    resetsAtMs: Date.parse("2026-11-16T12:00:00Z"),
  };
  expect(policy.decide(event)).toEqual({
    id: `weekly:claude-code:${event.resetsAtMs}`,
    kind: "weekly_limit",
    title: "Claude Code's weekly limit",
    body: "Claude Code's weekly limit is 95% used and resets on Monday. Keep running triggered flows?",
    target: { screen: "inbox", approvalId: "weekly-limit:claude-code" },
  });
  expect(policy.decide({ ...event, resetsAtMs: event.resetsAtMs + 1 })).toBeUndefined();
  clock.now += 86_400_000;
  expect(policy.decide({ ...event, resetsAtMs: event.resetsAtMs + 1 })?.id).toBe(
    `weekly:claude-code:${event.resetsAtMs + 1}`,
  );
  expect(policy.decide({ ...event, harnessId: "other" })?.title).toBe("A harness's weekly limit");
});

test("a flood notifies once per flow per local day", () => {
  const { policy } = setup();
  const event = { kind: "flood_cap" as const, flowId: "f", flowName: "Flow", day: "2026-11-12", cap: 24 };
  expect(policy.decide(event)).toEqual({
    id: "flood:252f10c83610ebca:2026-11-12",
    kind: "flood_cap",
    title: "Too many runs",
    body: "Flow reached its limit of 24 runs today. More fires are dropped until tomorrow.",
    target: { screen: "builder", flowId: "f" },
  });
  expect(policy.decide(event)).toBeUndefined();
  expect(policy.decide({ ...event, day: "2026-11-13" })).toBeDefined();
});

test("a hostile flow name cannot change the text around it", () => {
  const { policy } = setup();
  expect(
    policy.decide({ ...blocked("r1"), flowName: `${String.fromCodePoint(0x202e)}\n</b> click` })?.body,
  ).toBe("</b> click is blocked and needs a look.");
  expect(policy.decide({ ...blocked("r2"), flowId: "f2", flowName: "x".repeat(500) })?.body).toBe(
    `${"x".repeat(57)}... is blocked and needs a look.`,
  );
  expect(policy.decide({ ...blocked("r3"), flowId: "f3", flowName: "\n" })?.body).toBe(
    "A flow is blocked and needs a look.",
  );
});

test("no step output, no payload text and no unknown kind can produce a notice", () => {
  const { policy } = setup();
  expect(policy.decide({ kind: "progress" } as never)).toBeUndefined();
  expect(policy.decide({ kind: "run_done" } as never)).toBeUndefined();
});

test("an id with a slash or a space, or a harness id with capitals, returns undefined", () => {
  const { policy } = setup();
  expect(policy.decide(approval("a/b"))).toBeUndefined();
  expect(policy.decide(blocked("bad id"))).toBeUndefined();
  expect(
    policy.decide({ kind: "weekly_limit", harnessId: "Claude", percent: 50, resetsAtMs: 0 }),
  ).toBeUndefined();
});

test("the sent-id set is bounded", () => {
  const { policy } = setup();
  for (let i = 0; i < 1001; i++) expect(policy.decide(approval(`a${i}`))).toBeDefined();
  expect(policy.decide(approval("a0"))).toBeDefined();
  expect(policy.decide(approval("a1000"))).toBeUndefined();
});

test("a paused trigger notifies once, even right after a blocked-run notice of the same flow, with the pause text and a builder target", () => {
  const { policy } = setup();
  expect(policy.decide(blocked("r1"))).toBeDefined();
  const event = {
    kind: "trigger_paused" as const,
    flowId: "flow-1",
    index: 2,
    flowName: "Flow",
    pausedAt: "2026-11-12T00:00:00.000Z",
  };
  expect(policy.decide(event)).toEqual({
    id: `paused:e865168f04ce2eb6:2:${event.pausedAt}`,
    kind: "trigger_paused",
    title: "Trigger paused",
    body: "Flow was switched off after 3 blocked runs in a row.",
    target: { screen: "builder", flowId: "flow-1" },
  });
  expect(policy.decide(event)).toBeUndefined();
  expect(policy.decide({ ...event, index: -1 })).toBeUndefined();
});
