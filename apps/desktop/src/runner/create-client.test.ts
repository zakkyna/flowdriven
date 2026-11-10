import { expect, test } from "vitest";
import { createRunnerClient, scenarioFromSearch } from "./create-client";

test("the scenario query picks the sample data", async () => {
  expect(scenarioFromSearch("?scenario=empty")).toBe("empty");
  expect(scenarioFromSearch("?theme=dark&scenario=long")).toBe("long");
  expect(scenarioFromSearch("?scenario=nope")).toBe("story");
  expect(await createRunnerClient("?scenario=empty").call("flows.list", {})).toEqual([]);
  expect(await createRunnerClient("").call("flows.list", {})).toHaveLength(5);
  expect(await createRunnerClient("?scenario=long").call("flows.list", {})).toHaveLength(6);
});
