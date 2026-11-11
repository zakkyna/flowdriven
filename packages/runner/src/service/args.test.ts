import { expect, test } from "vitest";
import { parseArguments, scrubEnvironment } from "./args.ts";

test("parseArguments accepts --stdio, an absolute --data-dir and --demo and refuses everything else", () => {
  const usage = "Usage: main.ts --stdio --data-dir <absolute path> [--demo]";
  expect(parseArguments(["--stdio", "--data-dir", "/tmp/data", "--demo"])).toEqual({
    ok: true,
    options: { dataDir: "/tmp/data", demo: true },
  });
  expect(parseArguments(["--stdio", "--data-dir", "/tmp/data"])).toEqual({
    ok: true,
    options: { dataDir: "/tmp/data", demo: false },
  });
  for (const args of [
    ["--stdio", "--data-dir", "relative"],
    ["--data-dir", "/tmp/data"],
    ["--stdio", "--data-dir", "/tmp/data", "--other"],
    ["--stdio", "--stdio", "--data-dir", "/tmp/data"],
    ["--stdio", "--data-dir"],
  ])
    expect(parseArguments(args)).toEqual({ ok: false, message: usage });
});
test("scrubEnvironment removes ELECTRON_RUN_AS_NODE and nothing else", () => {
  const env = { ELECTRON_RUN_AS_NODE: "1", PATH: "example", OTHER: "value" };
  scrubEnvironment(env);
  expect(env).toEqual({ PATH: "example", OTHER: "value" });
});
