import { expect, test } from "vitest";
import { parseFlowYaml } from "../load/parse-yaml.ts";
import { flowV12, flowV12Yaml } from "../test-data/flow-v12.ts";
import { flow } from "../test-data/flows.ts";
import { upworkYaml } from "../test-data/upwork-yaml.ts";
import { parseManifest } from "./parse.ts";

test("TC-SDK-01 accepts 1.2 and detects formats", async () => {
  const { detectFormat } = await import("./manifest.ts");
  for (const version of ["1.1", "1.2", "1.3", "1", ""]) {
    const raw = { ...flow(), format: `flowdriven-flow/${version}` };
    expect(parseManifest(raw).ok).toBe(version === "1.1" || version === "1.2");
    expect(detectFormat(raw)).toBe(version === "1.1" || version === "1.2" ? version : undefined);
  }
});
test("TC-SDK-02 pins 1.1 parse issues", () => {
  const result = parseManifest(parseFlowYaml(upworkYaml));
  expect(result.ok ? [] : result.issues).toEqual([]);
  expect(result).toMatchObject({ ok: true, manifest: { format: "flowdriven-flow/1.1" } });
});
test("TC-SDK-03 rejects 1.2 keys on 1.1", () => {
  for (const key of ["touches", "result", "schedule"]) {
    const result = parseManifest({ ...flow(), [key]: {} });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual(expect.objectContaining({ path: key, code: "needs_format_1_2" }));
  }
});
test("TC-SDK-16 rejects permission keys", () => {
  for (const key of [
    "rules",
    "standing_rules",
    "grants",
    "confirmed",
    "confirmations",
    "onItsOwn",
    "allowed_always",
    "approvals",
  ]) {
    const result = parseManifest({
      ...flow(),
      format: "flowdriven-flow/1.2",
      [key]: key === "approvals" ? { allow: ["send"] } : true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "unknown_field",
          path: key === "approvals" ? "approvals.allow" : key,
        }),
      );
  }
  expect(
    parseManifest({ ...flow(), format: "flowdriven-flow/1.2", approvals: { extra_risky: ["publish"] } }).ok,
  ).toBe(true);
});

test("1.2 input sample round trips and custom issues survive parsing", () => {
  for (const sample of [flowV12(), parseFlowYaml(flowV12Yaml())]) {
    const result = parseManifest(sample);
    expect(result.ok).toBe(true);
    if (result.ok) expect(parseManifest(result.manifest)).toEqual(result);
  }
  const bad = parseManifest(flowV12({ inputs: [{ id: "day", label: "Day", type: "date", remember: true }] }));
  expect(bad.ok).toBe(false);
  if (!bad.ok)
    expect(bad.issues).toContainEqual(
      expect.objectContaining({ code: "remember_date_time", path: "inputs.0.remember" }),
    );
  const legacy = parseManifest({ ...flow(), inputs: [{ id: "item", label: "Item", type: "enum" }] });
  expect(legacy.ok && legacy.manifest.inputs[0]?.type).toBe("enum");
});
