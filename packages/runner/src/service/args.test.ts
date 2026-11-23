import { expect, test } from "vitest";
import { parseArguments, scrubEnvironment } from "./args.ts";

test("parseArguments accepts --stdio, an absolute --data-dir and --demo and refuses everything else", () => {
  const usage = "Usage: main.ts --stdio --data-dir <absolute path> [--demo] [--languages=en,id]";
  expect(parseArguments(["--stdio", "--data-dir", "/tmp/data", "--demo"])).toEqual({
    ok: true,
    options: { dataDir: "/tmp/data", demo: true, languages: ["en"] },
  });
  expect(parseArguments(["--stdio", "--data-dir", "/tmp/data"])).toEqual({
    ok: true,
    options: { dataDir: "/tmp/data", demo: false, languages: ["en"] },
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
test("TC-AGT-40 registered languages are parsed and validated", () => {
  const base = ["--stdio", "--data-dir", "/tmp/data"];
  for (const [arg, languages] of [
    ["--languages=en,id", ["en", "id"]],
    ["--languages=en", ["en"]],
  ] as const)
    expect(parseArguments([...base, arg])).toMatchObject({ ok: true, options: { languages } });
  expect(parseArguments(base)).toMatchObject({ ok: true, options: { languages: ["en"] } });
  for (const arg of ["--languages=id", "--languages=EN", "--languages=", "--languages=en,en", "--other"])
    expect(parseArguments([...base, arg])).toMatchObject({ ok: false });
});
