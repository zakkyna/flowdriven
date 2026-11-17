import { expect, test } from "vitest";
import { CapabilityRow, ENFORCERS, FlowCapabilities } from "./capability.ts";
import { Requirement } from "./flow.ts";
import { operations } from "./operations.ts";
import { LeafStepRun } from "./run.ts";

const routed = {
  requirementId: "web",
  type: "web",
  sentence: "Reads pages.",
  routed: true,
  provider: "Chrome",
  enforcedBy: "FlowDriven",
  label: "unofficial",
  away: true,
  details: [],
};
const dropped = {
  requirementId: "web",
  type: "web",
  sentence: "Unavailable.",
  routed: false,
  reason: "Not available.",
  away: false,
  details: [],
};
const hash = `sha256:${"a".repeat(64)}`;

test("a routed row has a provider, who enforces it and a label, and a dropped row has a reason", () => {
  expect(CapabilityRow.parse(routed)).toEqual(routed);
  expect(CapabilityRow.parse(dropped)).toEqual(dropped);
  for (const field of ["provider", "enforcedBy", "label"] as const) {
    const incomplete = { ...routed, [field]: undefined };
    expect(CapabilityRow.safeParse(incomplete).success).toBe(false);
  }
  expect(CapabilityRow.safeParse({ ...dropped, reason: undefined }).success).toBe(false);
  expect(CapabilityRow.safeParse({ ...routed, enforcedBy: "other" }).success).toBe(false);
  expect(CapabilityRow.safeParse({ ...routed, extra: true }).success).toBe(false);
  expect(CapabilityRow.safeParse({ ...routed, sentence: "a".repeat(2500) }).success).toBe(false);
  expect(CapabilityRow.safeParse({ ...routed, sentence: "a".repeat(2000) }).success).toBe(true);
});
test("the four enforcers are the four of spec 20.2, in that order", () => {
  expect(ENFORCERS).toEqual([
    "FlowDriven",
    "FlowDriven hook in Claude Code",
    "Claude Code's settings",
    "not enforced",
  ]);
});
test("a capabilities value has rows, caps, triggers, needsAllow and a consent state", () => {
  const value = {
    flowId: "flow",
    hash,
    rows: [routed, dropped],
    caps: { maxRunsPerDay: 3, maxItems: 2 },
    hasTriggers: true,
    needsAllow: true,
    consent: "given",
  };
  expect(FlowCapabilities.parse(value)).toEqual(value);
  const minimal = {
    ...value,
    rows: [],
    caps: { maxRunsPerDay: 1 },
    hasTriggers: false,
    needsAllow: false,
    consent: "none",
  };
  expect(FlowCapabilities.parse(minimal)).toEqual(minimal);
  expect(FlowCapabilities.safeParse({ ...value, caps: { maxRunsPerDay: 0 } }).success).toBe(false);
  expect(FlowCapabilities.safeParse({ ...value, consent: "maybe" }).success).toBe(false);
});
test("allowBlocked is optional, and a text of 1 to 200 characters parses", () => {
  const base = {
    flowId: "flow",
    hash,
    rows: [routed, dropped],
    caps: { maxRunsPerDay: 3 },
    hasTriggers: false,
    needsAllow: true,
    consent: "none",
  };
  expect(FlowCapabilities.safeParse(base).success).toBe(true);
  expect("allowBlocked" in FlowCapabilities.parse(base)).toBe(false);
  for (const allowBlocked of ["a", "a".repeat(200)]) {
    expect(FlowCapabilities.parse({ ...base, allowBlocked })).toEqual({ ...base, allowBlocked });
  }
  expect(FlowCapabilities.safeParse({ ...base, allowBlocked: "" }).success).toBe(false);
  expect(FlowCapabilities.safeParse({ ...base, allowBlocked: "a".repeat(201) }).success).toBe(false);
  expect(FlowCapabilities.safeParse({ ...base, allowBlocked: 3 }).success).toBe(false);
});
test("the three operations take a flow id, the allow also takes a content hash, and all three are off MCP", () => {
  for (const name of [
    "flows.capabilities",
    "flows.allowCapabilities",
    "flows.withdrawCapabilities",
  ] as const) {
    const operation = operations[name];
    expect(operation.mcp).toBe("no");
    expect(
      operation.input.safeParse(
        name === "flows.allowCapabilities" ? { flowId: "flow", hash } : { flowId: "flow" },
      ).success,
    ).toBe(true);
    expect(operation.input.safeParse({}).success).toBe(false);
  }
  expect(operations["flows.allowCapabilities"].input.safeParse({ flowId: "flow", hash: "abc" }).success).toBe(
    false,
  );
});
test("a requirement keeps session, url_patterns, rate and on_challenge, and a rate of 0 is refused", () => {
  const fields = {
    session: "own",
    url_patterns: ["https://example.com/"],
    rate: { per_run: 2, per_day: 4 },
    on_challenge: "stop",
  };
  const base = { id: "web", type: "web", ref: "web", why: "Read" };
  expect(Requirement.parse({ ...base, ...fields })).toMatchObject(fields);
  expect(Requirement.safeParse({ ...base, ...fields, rate: { per_run: 0 } }).success).toBe(false);
  expect(Requirement.safeParse({ ...base, ...fields, rate: { per_day: 0 } }).success).toBe(false);
});
test("a step run keeps outside and pagesRead and is valid without them", () => {
  const step = {
    stepId: "step",
    title: "Step",
    do: "worker",
    state: "passed",
    attempts: [],
    maxAttempts: 1,
    checks: [],
  };
  expect(LeafStepRun.parse({ ...step, outside: true, pagesRead: 1 })).toMatchObject({
    outside: true,
    pagesRead: 1,
  });
  expect(LeafStepRun.parse(step)).toEqual(step);
  expect(LeafStepRun.safeParse({ ...step, pagesRead: -1 }).success).toBe(false);
});

test("a capability row may carry a pin of at most 600 characters, and an empty pin is refused", () => {
  for (const pin of ["a", "a".repeat(600)]) {
    expect(CapabilityRow.parse({ ...routed, pin })).toEqual({ ...routed, pin });
  }
  for (const pin of ["", "a".repeat(601)]) {
    expect(CapabilityRow.safeParse({ ...routed, pin }).success).toBe(false);
  }
});

test("allowCapabilities takes optional pins keyed by requirement id, and refuses more than 50 pins", () => {
  const input = operations["flows.allowCapabilities"].input;
  const base = { flowId: "flow", hash };
  const pins = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`id${i}`, "a".repeat(600)]));
  expect(input.parse({ ...base, pins })).toEqual({ ...base, pins });
  expect(input.safeParse({ ...base, pins: { ...pins, extra: "x" } }).success).toBe(false);
  for (const invalid of [{ "": "x" }, { ["a".repeat(101)]: "x" }, { id: "" }, { id: "a".repeat(601) }]) {
    expect(input.safeParse({ ...base, pins: invalid }).success).toBe(false);
  }
  expect(input.parse({ ...base, pins: { ["a".repeat(100)]: "x" } })).toEqual({
    ...base,
    pins: { ["a".repeat(100)]: "x" },
  });
});

test("a leaf step run may carry its time limit in milliseconds, a whole number of at least 1", () => {
  const step = {
    stepId: "step",
    title: "Step",
    do: "worker",
    state: "passed",
    attempts: [],
    maxAttempts: 1,
    checks: [],
  };
  expect(LeafStepRun.parse({ ...step, limitMs: 1 })).toEqual({ ...step, limitMs: 1 });
  for (const limitMs of [0, -1, 1.5]) {
    expect(LeafStepRun.safeParse({ ...step, limitMs }).success).toBe(false);
  }
});

test("an old payload without pin, pins or limitMs still parses", () => {
  const step = {
    stepId: "step",
    title: "Step",
    do: "worker",
    state: "passed",
    attempts: [],
    maxAttempts: 1,
    checks: [],
  };
  expect(CapabilityRow.parse(routed)).toEqual(routed);
  expect(operations["flows.allowCapabilities"].input.parse({ flowId: "flow", hash })).toEqual({
    flowId: "flow",
    hash,
  });
  expect(LeafStepRun.parse(step)).toEqual(step);
});
