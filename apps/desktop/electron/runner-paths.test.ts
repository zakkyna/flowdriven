import { isAbsolute, resolve } from "node:path";
import { expect, test } from "vitest";
import { dataDirFor, isDemo, runnerEntry, runnerEnv } from "./runner-paths";

test("the data folder is FLOWDRIVEN_DATA_DIR, else FlowDriven, else FlowDriven-demo with FLOWDRIVEN_DEMO=1", () => {
  expect(dataDirFor({ FLOWDRIVEN_DATA_DIR: "rel/data" }, "/data")).toBe(resolve("rel/data"));
  expect(isAbsolute(dataDirFor({ FLOWDRIVEN_DATA_DIR: "rel/data" }, "/data"))).toBe(true);
  expect(dataDirFor({}, "/data")).toBe("/data/FlowDriven");
  expect(dataDirFor({ FLOWDRIVEN_DEMO: "1" }, "/data")).toBe("/data/FlowDriven-demo");
});
test("the runner's environment is ELECTRON_RUN_AS_NODE and the five named variables only", () => {
  expect(
    runnerEnv({
      SECRET: "secret",
      ELECTRON_RUN_AS_NODE: "0",
      PATH: "p",
      HOME: "h",
      USER: "u",
      TMPDIR: "t",
      LANG: "l",
      NODE_OPTIONS: "x",
    }),
  ).toEqual({ ELECTRON_RUN_AS_NODE: "1", PATH: "p", HOME: "h", USER: "u", TMPDIR: "t", LANG: "l" });
  expect(runnerEnv({ PATH: undefined })).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
});
test("the entry is found from the compiled folder", () => {
  expect(runnerEntry("/r/apps/desktop/dist-electron")).toBe("/r/packages/runner/src/main.ts");
  expect(isDemo({ FLOWDRIVEN_DEMO: "1" })).toBe(true);
  expect(isDemo({ FLOWDRIVEN_DEMO: "true" })).toBe(false);
  expect(isDemo({})).toBe(false);
});
