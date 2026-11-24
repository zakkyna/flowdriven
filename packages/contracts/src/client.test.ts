import { expect, test, vi } from "vitest";
import { type RunnerClient, RunnerEvent, startupCheck } from "./client.ts";

test("TC-CON-28 event topics and strict shape", () => {
  expect(
    RunnerEvent.safeParse({ type: "changed", topics: ["chats", "rules", "activity", "agents", "skills"] })
      .success,
  ).toBe(true);
  expect(RunnerEvent.safeParse({ type: "changed", topics: [] }).success).toBe(true);
  for (const value of [
    { type: "changed", topics: ["harnesses"] },
    { type: "changed", topics: ["memory"] },
    { type: "progress", topics: [] },
    { type: "changed", topics: [], extra: 1 },
  ])
    expect(RunnerEvent.safeParse(value).success).toBe(false);
});

test("TC-CON-34 startup checks runner.info once and refuses a mismatch", async () => {
  for (const contractVersion of [1, 2]) {
    const info = { contractVersion, appVersion: "0.1.0", storeVersion: 6, mode: "live" as const };
    const call = vi.fn().mockResolvedValue(info);
    const client: RunnerClient = { call, subscribe: () => () => {} };
    await expect(startupCheck(client)).resolves.toEqual(
      contractVersion === 2 ? { ok: true, info } : { ok: false, reason: "contract_mismatch" },
    );
    expect(call).toHaveBeenCalledExactlyOnceWith("runner.info", {});
  }
});
