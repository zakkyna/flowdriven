import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  Reflect.deleteProperty(window, "flowdrivenShell");
});

import { createRunnerClient, scenarioFromSearch } from "./create-client";

test("the scenario query picks the sample data", async () => {
  expect(scenarioFromSearch("?scenario=empty")).toBe("empty");
  expect(scenarioFromSearch("?theme=dark&scenario=long")).toBe("long");
  expect(scenarioFromSearch("?scenario=looped")).toBe("looped");
  expect(await createRunnerClient("?scenario=looped").call("flows.list", {})).toHaveLength(6);
  expect(scenarioFromSearch("?scenario=nope")).toBe("story");
  expect(await createRunnerClient("?scenario=empty").call("flows.list", {})).toEqual([]);
  expect(await createRunnerClient("").call("flows.list", {})).toHaveLength(5);
  expect(await createRunnerClient("?scenario=long").call("flows.list", {})).toHaveLength(6);
});

test("createRunnerClient uses the bridge when flowdrivenShell.runner exists", async () => {
  const call = vi.fn().mockResolvedValue({ ok: true, result: { contractVersion: 1, mode: "demo" } });
  Object.assign(window, {
    flowdrivenShell: { kind: "electron", runner: { call, subscribe: () => () => {} } },
  });
  expect(await createRunnerClient().call("runner.info", {})).toEqual({ contractVersion: 1, mode: "demo" });
  expect(call).toHaveBeenCalledWith("runner.info", {});
});
test("without a bridge it is the sample data", async () => {
  expect((await createRunnerClient().call("runner.info", {})).mode).toBe("sample");
});
