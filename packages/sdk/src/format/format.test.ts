import { expect, test } from "vitest";
import { Duration, durationMs, parseManifest } from "../index.ts";
import { upworkJobReview } from "../test-data/upwork.ts";

const ok = (raw: unknown) => {
  const r = parseManifest(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.manifest;
};
const bad = (raw: unknown) => {
  const r = parseManifest(raw);
  if (r.ok) throw new Error("expected issues");
  return r.issues;
};
const min = (extra: Record<string, unknown> = {}) => ({
  format: "flowdriven-flow/1.1",
  id: "local.min",
  name: "Min",
  kind: "build",
  steps: [{ id: "a", do: "worker", instructions: "Work", ...extra }],
});
const nested = () => ({
  ...min(),
  steps: [
    {
      id: "loop",
      for_each: "items",
      as: "item",
      steps: [{ id: "nested", for_each: "items", as: "item", steps: [] }],
    },
  ],
});
const withTrigger = (trigger: unknown) => ({ ...min(), triggers: [trigger] });
const withReq = (requirement: unknown) => ({ ...min(), requirements: [requirement] });
test("accepts the Upwork example of spec 20.4", () => {
  const m = ok(upworkJobReview);
  expect(m.requirements.map((r) => r.type)).toEqual(["mcp_server", "web", "skill", "mcp_server", "path"]);
  expect(m.steps.map((s) => s.id)).toEqual(["alerts", "review", "pick", "build"]);
  expect(m.version).toBe("0.1.0");
  expect(m.triggers.at(0)).toMatchObject({ kind: "schedule", every: "1h", catch_up: "once" });
  expect(m.steps.at(2)).toMatchObject({
    do: "ask",
    ask: { on_expiry: "end", expires: "24h", max_pick: "${params.daily_builds}" },
  });
});
test("applies the step defaults", () =>
  expect(ok(min()).steps.at(0)).toMatchObject({ retry: 2, uses: [], checks: [] }));
test("refuses an unknown field", () =>
  expect(bad(min({ colour: "red" }))).toContainEqual(
    expect.objectContaining({ code: "unknown_field", path: "steps.0.colour" }),
  ));
test("refuses a step id that cannot be referenced", () =>
  expect(bad(min({ id: "1st" })).map((i) => i.path)).toContain("steps.0.id"));
test("refuses a nested loop", () =>
  expect(bad(nested())).toContainEqual(
    expect.objectContaining({ code: "nested_loop", path: "steps.0.steps.0" }),
  ));
test("an ask step without its ask object points at the field", () =>
  expect(bad(min({ do: "ask" })).map((i) => i.path)).toContain("steps.0.ask"));
test("refuses format 1", () =>
  expect(bad({ ...min(), format: "flowdriven-flow/1" }).at(0)).toMatchObject({
    code: "unsupported_format",
    path: "format",
  }));
test("a schedule needs exactly one of every and at", () =>
  expect(bad(withTrigger({ kind: "schedule", every: "1h", at: "08:00" })).at(0)?.path).toBe("triggers.0"));
test("new_item polls at most every 5 minutes", () =>
  expect(
    bad(withTrigger({ kind: "new_item", source: "g", query: "q", every: "1m", key: "id" })).at(0)?.path,
  ).toBe("triggers.0.every"));
test("a command check names a program, never a path", () =>
  expect(bad(min({ checks: [{ type: "command", cmd: "/bin/sh" }] })).map((i) => i.path)).toContain(
    "steps.0.checks.0.cmd",
  ));
test("a web requirement defaults to a managed session and always stops on a challenge", () => {
  expect(ok(withReq({ id: "w", type: "web", mode: "read" })).requirements.at(0)).toMatchObject({
    session: "managed",
    on_challenge: "stop",
  });
  expect(
    bad(withReq({ id: "w", type: "web", mode: "read", on_challenge: "continue" })).length,
  ).toBeGreaterThan(0);
});
test("durations", () => {
  expect(durationMs("150m")).toBe(9_000_000);
  expect(durationMs("24h")).toBe(86_400_000);
  expect(durationMs("10s")).toBe(10_000);
  for (const text of ["1.5h", "30 min", "0m", ""]) expect(Duration.safeParse(text).success).toBe(false);
});
