import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createServiceHarness } from "./service-harness.ts";

test("opens a store in the test folder, dispatches calls and cleans up", async () => {
  const parent = mkdtempSync(join(tmpdir(), "flowdriven-test-"));
  try {
    const harness = await createServiceHarness(parent);
    expect(harness.dataDir.startsWith(`${parent}/`)).toBe(true);
    expect(existsSync(join(harness.dataDir, "flowdriven.sqlite"))).toBe(true);
    expect(harness.store.listRuns({})).toEqual([]);
    await expect(harness.call("runner.info", {})).resolves.toHaveProperty("contractVersion");
    await expect(harness.call("not.anOperation", {})).rejects.toMatchObject({ code: "not_found" });
    await harness.close();
    expect(existsSync(harness.dataDir)).toBe(false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
