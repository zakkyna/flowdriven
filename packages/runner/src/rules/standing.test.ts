import { expect, test } from "vitest";
import { ruleOf } from "../test-helpers/policy-fixture.ts";

test("TC-RUL-11 matches only the exact active rule and run version", async () => {
  const { matchRule } = await import("./standing.ts");
  const place = { kind: "account", value: "timesheet-account", label: "Timesheet" };
  const rule = ruleOf("example.fill-timesheet", "log-hours", { place });
  const call = { flowId: rule.flowId, touchId: rule.touchId, effect: rule.effect, place };
  const touch = { id: rule.touchId, effect: rule.effect, place };
  const version = { touches: [touch] };
  expect(matchRule([rule], call, version)).toEqual(rule);
  expect(matchRule([rule], { ...call, place: { ...place, label: "Other label" } }, version)).toEqual(rule);
  for (const other of [
    { ...call, flowId: "another" },
    { ...call, touchId: "another" },
    { ...call, effect: "send" },
    { ...call, place: { ...place, value: "other-account" } },
    { ...call, place: { ...place, kind: "site" } },
  ])
    expect(matchRule([rule], other, version)).toBeUndefined();
  expect(matchRule([{ ...rule, state: "revoked" }], call, version)).toBeUndefined();
  expect(matchRule([rule], call, { touches: [] })).toBeUndefined();
  expect(matchRule([rule], call, { touches: [{ ...touch, effect: "send" }] })).toBeUndefined();
  expect(
    matchRule([rule], call, { touches: [{ ...touch, place: { ...place, value: "other" } }] }),
  ).toBeUndefined();
  const sendRule = { ...rule, effect: "send" };
  expect(
    matchRule([sendRule], { ...call, effect: "send" }, { touches: [{ ...touch, effect: "send" }] }),
  ).toBeUndefined();
});
