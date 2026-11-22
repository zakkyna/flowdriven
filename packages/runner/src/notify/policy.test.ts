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
    title: { key: "notice.decisionTitle" },
    body: { key: "notice.decisionBody" },
    language: "en",
    target: { screen: "run", runId: "run-1", approvalId: "a1" },
  });
  expect(policy.decide(approval("a2"))?.id).toBe("approval:a2");
  expect(policy.decide(approval("a1"))).toBeUndefined();
});

test("a blocked run notifies once and not again within 10 minutes; the same flow blocking again within 6 hours says nothing; after 6 hours it notifies", () => {
  const { policy, clock } = setup();
  expect(policy.decide(blocked("r1"))).toEqual({
    id: "blocked:r1",
    kind: "run_blocked",
    title: { key: "notice.problemTitle" },
    body: { key: "notice.problemBody" },
    language: "en",
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
    title: { key: "notice.limitTitle" },
    body: { key: "notice.limitBody" },
    language: "en",
    target: { screen: "activity" },
  });
  expect(policy.decide({ ...event, resetsAtMs: event.resetsAtMs + 1 })).toBeUndefined();
  clock.now += 86_400_000;
  expect(policy.decide({ ...event, resetsAtMs: event.resetsAtMs + 1 })?.id).toBe(
    `weekly:claude-code:${event.resetsAtMs + 1}`,
  );
  expect(policy.decide({ ...event, harnessId: "other" })?.title).toEqual({ key: "notice.limitTitle" });
});

test("a flood notifies once per flow per local day", () => {
  const { policy } = setup();
  const event = { kind: "flood_cap" as const, flowId: "f", flowName: "Flow", day: "2026-11-12", cap: 24 };
  expect(policy.decide(event)).toEqual({
    id: "flood:252f10c83610ebca:2026-11-12",
    kind: "flood_cap",
    title: { key: "notice.limitTitle" },
    body: { key: "notice.limitBody" },
    language: "en",
    target: { screen: "flow", flowId: "f" },
  });
  expect(policy.decide(event)).toBeUndefined();
  expect(policy.decide({ ...event, day: "2026-11-13" })).toBeDefined();
});

test("TC-SR5-16 hostile flow names never reach fixed notices", () => {
  const { policy } = setup();
  for (const [i, flowName] of [
    `${String.fromCodePoint(0x202e)}\n</b> click`,
    "x".repeat(500),
    "\n",
  ].entries()) {
    const notice = policy.decide({ ...blocked(`r${i}`), flowId: `f${i}`, flowName });
    expect(notice?.body).toEqual({ key: "notice.problemBody" });
    expect(JSON.stringify(notice)).not.toContain(flowName);
  }
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
    title: { key: "notice.limitTitle" },
    body: { key: "notice.limitBody" },
    language: "en",
    target: { screen: "flow", flowId: "flow-1" },
  });
  expect(policy.decide(event)).toBeUndefined();
  expect(policy.decide({ ...event, index: -1 })).toBeUndefined();
});

test("the notice of a challenge pause names the login or robot check, and the notice of a three-blocked pause is the present one", () => {
  const { policy } = setup();
  const event = {
    kind: "trigger_paused" as const,
    flowId: "flow-1",
    index: 2,
    flowName: "Flow",
    pausedAt: "2026-11-12T00:00:00.000Z",
  };
  expect(policy.decide({ ...event, why: "challenge" })).toMatchObject({
    kind: "trigger_paused",
    title: { key: "notice.limitTitle" },
    body: { key: "notice.limitBody" },
    target: { screen: "flow", flowId: "flow-1" },
  });
  expect(policy.decide({ ...event, index: 3, why: "blocked_runs" })?.body).toEqual({
    key: "notice.limitBody",
  });
  expect(policy.decide({ ...event, index: 4 })?.body).toEqual({ key: "notice.limitBody" });
  expect(policy.decide({ ...event, index: 5, why: "other" as never })).toBeUndefined();
});
