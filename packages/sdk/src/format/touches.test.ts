import { expect, test } from "vitest";
import { contentHash } from "../hash/canonical.ts";
import { flowV12 } from "../test-data/flow-v12.ts";
import { validateManifest } from "../validate/validate.ts";
import { parseManifest } from "./parse.ts";

const touch = {
  id: "log-hours",
  sentence: "Logs your hours",
  effect: "change",
  place: { kind: "account", value: "timesheet-account", label: "Timesheet account" },
  rule: "asks_first",
};
const parse = (touches: unknown[]) => parseManifest(flowV12({ touches }));
test("TC-SR2-08 rejects approval state in a flow", () => {
  for (const [key, value, path] of [
    ["approvals", [{ touch: "reply", state: "approved" }], "approvals"],
    ["standing_rules", [], "standing_rules"],
    ["onItsOwn", ["reply"], "onItsOwn"],
  ] as const) {
    const result = parseManifest(flowV12({ [key]: value }));
    expect(result.ok ? [] : result.issues).toContainEqual(expect.objectContaining({ path }));
  }
  const result = parse([{ ...touch, approved: true }]);
  expect(result.ok ? [] : result.issues).toContainEqual(
    expect.objectContaining({ code: "unknown_field", path: "touches.0.approved" }),
  );
  expect(parseManifest(flowV12({ triggers: [{ kind: "schedule", at: "17:00" }] })).ok).toBe(true);
});
test("TC-SR3-02 hashes touch and place bytes", () => {
  const base = { touches: [touch], steps: [{ instructions: "Work" }] };
  const files = (value: unknown, reverse = false) => {
    const entries: [string, Uint8Array][] = [
      ["flow.yaml", new TextEncoder().encode(JSON.stringify(value))],
      ["readme.md", new TextEncoder().encode("read")],
    ];
    return new Map(reverse ? entries.reverse() : entries);
  };
  expect(parse([touch]).ok).toBe(true);
  const hash = contentHash(files(base));
  for (const changed of [
    { ...base, touches: [{ ...touch, place: { ...touch.place, value: "other" } }] },
    { ...base, touches: [{ ...touch, effect: "post" }] },
    { ...base, touches: [{ ...touch, rule: "runs_alone" }] },
    { ...base, steps: [{ instructions: "Work " }] },
    { ...base, touches: [touch, { ...touch, id: "reply" }] },
  ])
    expect(contentHash(files(changed))).not.toBe(hash);
  expect(contentHash(files(base, true))).toBe(hash);
  expect(contentHash(files(base))).toBe(hash);
});
test("TC-SDK-09 touch shape and limits", () => {
  for (const effect of [
    "read",
    "local_write",
    "run_command",
    "change",
    "send",
    "post",
    "pay",
    "delete",
    "merge",
  ])
    expect(parse([{ ...touch, effect }]).ok).toBe(true);
  for (const rule of ["runs_alone", "asks_first", "not_allowed"])
    expect(parse([{ ...touch, rule }]).ok).toBe(true);
  expect(parse([{ ...touch, sentence: "x".repeat(200) }]).ok).toBe(true);
  for (const bad of [
    { effect: "email" },
    { rule: "always" },
    { sentence: "" },
    { sentence: "x".repeat(201) },
    { place: { ...touch.place, kind: "email" } },
    { onItsOwn: true },
    { byRule: true },
    { allowed: true },
    { rule: "allowed_always" },
  ])
    expect(parse([{ ...touch, ...bad }]).ok).toBe(false);
  expect(parse(Array.from({ length: 101 }, (_, i) => ({ ...touch, id: `item-${i}` }))).ok).toBe(false);
  const duplicate = parse([touch, touch]);
  expect(duplicate.ok ? [] : duplicate.issues).toContainEqual(
    expect.objectContaining({ code: "touch_duplicate" }),
  );
});
test("TC-SDK-10 and TC-SDK-11 validate places and risky claims", () => {
  const requirements = [
    { id: "timesheet-account", type: "account" },
    { id: "reports", type: "path" },
  ];
  for (const [place, code] of [
    [touch.place, ""],
    [{ ...touch.place, value: "other" }, "touch_place_undeclared"],
    [{ kind: "folder", value: "reports", label: "Reports" }, ""],
    [{ kind: "folder", value: "elsewhere", label: "Other" }, "touch_place_undeclared"],
    [undefined, ""],
  ] as const) {
    const parsed = parseManifest(flowV12({ requirements, touches: [{ ...touch, place }] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(validateManifest(parsed.manifest).some((i) => i.code === "touch_place_undeclared")).toBe(
        Boolean(code),
      );
  }
  for (const [overrides, code] of [
    [{ rule: "not_allowed" }, "touch_never_has_place"],
    [
      {
        effect: "send",
        rule: "runs_alone",
        place: { kind: "address", value: "own-address", label: "Your address" },
      },
      "risky_claims_runs_alone",
    ],
  ] as const) {
    const parsed = parseManifest(flowV12({ requirements, touches: [{ ...touch, ...overrides }] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.format === "flowdriven-flow/1.2" && parsed.manifest.touches?.[0]?.rule).toBe(
        overrides.rule,
      );
      expect(validateManifest(parsed.manifest)).toContainEqual(
        expect.objectContaining({ code, severity: "warning" }),
      );
    }
  }
});

test("TC-SDK-03 and TC-SDK-16 accept 1.2 fields and reject touch permissions", () => {
  expect(parseManifest(flowV12({ result: { kind: "chat" }, touches: [touch] })).ok).toBe(true);
  for (const extra of [{ allowed: true }, { rule: "allowed_always" }])
    expect(parse([{ ...touch, ...extra }]).ok).toBe(false);
});
