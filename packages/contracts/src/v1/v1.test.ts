import { expect, test } from "vitest";
import fixturesPackage from "../../../../packages/fixtures/package.json" with { type: "json" };
import contractsPackage from "../../package.json" with { type: "json" };
import { FlowSummary, HarnessCard, operations, RunSummary } from "./index";

declare global {
  interface ImportMeta {
    readonly url: string;
    resolve(specifier: string, parent?: string): string;
  }

  interface URL {
    readonly href: string;
  }

  const URL: { new (url: string, base?: string): URL };
}

test("TC-CON-39 keeps version 1 contract and fixture exports available", async () => {
  const fixtureImporter = new URL("../../../../apps/desktop/src/main.tsx", import.meta.url).href;
  const fixtureEntry = import.meta.resolve("@flowdriven/fixtures/v1", fixtureImporter);
  const fixtures = await import(fixtureEntry);
  const client = fixtures.createFixtureRunnerClient();
  const flowRows = await client.call("flows.list", {});
  const runRows = await client.call("runs.list", {});
  const queue = await client.call("queue.list", {});

  expect(Object.keys(operations)).toHaveLength(31);
  expect(operations["flows.build"]).toBeDefined();
  expect(operations["flows.update"]).toBeDefined();
  expect(operations["harnesses.list"]).toBeDefined();
  expect(operations["queue.list"]).toBeDefined();
  expect(operations["usage.summary"]).toBeDefined();
  expect(FlowSummary.parse(flowRows[0])).toBeDefined();
  expect(RunSummary.parse(runRows[0])).toBeDefined();
  expect(HarnessCard.parse(client.state.harnesses[0])).toBeDefined();
  expect(operations["flows.list"].output.parse(flowRows)).toEqual(flowRows);
  expect(operations["queue.list"].output.parse(queue)).toEqual(queue);
  expect("CONTRACT_VERSION_V1" in (await import("./index"))).toBe(true);
  expect("CONTRACT_VERSION" in (await import("./index"))).toBe(false);

  expect(contractsPackage.exports["./v1"]).toBe("./src/v1/index.ts");
  expect(fixturesPackage.exports["./v1"]).toBe("./src/v1/index.ts");
  const contractImporter = new URL("../../../../packages/fixtures/src/v1/client.ts", import.meta.url).href;
  expect(import.meta.resolve("@flowdriven/contracts/v1", contractImporter)).toContain(
    "/packages/contracts/src/v1/index.ts",
  );
  expect(fixtureEntry).toContain("/packages/fixtures/src/v1/index.ts");
});
