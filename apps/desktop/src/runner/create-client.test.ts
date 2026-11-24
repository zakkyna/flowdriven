import { afterEach, expect, test, vi } from "vitest";
import { createRunnerClient, scenarioFromSearch } from "./create-client";

afterEach(() => {
  Reflect.deleteProperty(window, "flowdrivenShell");
});

test("the scenario query picks the sample data", async () => {
  expect(scenarioFromSearch("?scenario=empty")).toBe("empty");
  expect(scenarioFromSearch("?theme=dark&scenario=story-v2")).toBe("story-v2");
  expect(scenarioFromSearch("?scenario=nope")).toBe("story-v2");
  expect(scenarioFromSearch("?scenario=long")).toBe("story-v2");
  expect(scenarioFromSearch("")).toBe("story-v2");
  expect(await createRunnerClient("?scenario=empty").call("flows.list", {})).toEqual([]);
  expect(await createRunnerClient("").call("flows.list", {})).toHaveLength(5);
});

test("createRunnerClient uses the bridge when flowdrivenShell.runner exists", async () => {
  const call = vi.fn().mockResolvedValue({
    ok: true,
    result: { contractVersion: 2, appVersion: "0.1.0", storeVersion: 7, mode: "demo" },
  });
  Object.assign(window, {
    flowdrivenShell: { kind: "electron", runner: { call, subscribe: () => () => {} } },
  });
  expect(await createRunnerClient().call("runner.info", {})).toEqual({
    contractVersion: 2,
    appVersion: "0.1.0",
    storeVersion: 7,
    mode: "demo",
  });
  expect(call).toHaveBeenCalledWith("runner.info", {});
});

test("without a bridge it is the sample data", async () => {
  expect(await createRunnerClient().call("runner.info", {})).toMatchObject({
    contractVersion: 2,
    mode: "sample",
  });
});
