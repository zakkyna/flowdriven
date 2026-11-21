import { expect, test } from "vitest";
import { flowV12 } from "../test-data/flow-v12.ts";
import { flow } from "../test-data/flows.ts";
import { parseManifest } from "./parse.ts";

test("TC-SR9-11 rejects limits and settings from a flow", () => {
  for (const base of [flow(), flowV12()]) {
    expect(parseManifest(base).ok).toBe(true);
    for (const extra of [{ limits: { budget_usd: 9999 } }, { spendingLimit: 9999 }, { settings: {} }]) {
      const result = parseManifest({ ...base, ...extra });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0]?.code).toBe("unknown_field");
        expect(result.issues).toContainEqual(
          expect.objectContaining({
            code: "unknown_field",
            path: "limits" in extra ? "limits.budget_usd" : Object.keys(extra)[0],
          }),
        );
      }
    }
  }
});
