import { expect, test, vi } from "vitest";
import { createFixtureRunnerClient } from "./client";

test("records calls in order, including rejected calls, through the spied call method", async () => {
  const client = createFixtureRunnerClient();
  const spy = vi.spyOn(client, "call");
  expect(client.calls).toEqual([]);
  await client.call("runner.info", {});
  await expect(client.call("runs.status", { runId: "missing" })).rejects.toThrow();
  expect(client.calls).toEqual([
    { operation: "runner.info", input: {} },
    { operation: "runs.status", input: { runId: "missing" } },
  ]);
  expect(spy).toHaveBeenCalledTimes(2);
});
