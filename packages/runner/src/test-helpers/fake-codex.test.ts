import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { exampleAgentProfile } from "./agent-profiles.ts";
import { FAKE_CODEX_PATH, makeFakeCodexHome, readFakeCodexCalls } from "./fake-codex-script.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function run(home: string, args: string[], input = "") {
  return spawnSync(FAKE_CODEX_PATH, args, {
    cwd: home,
    env: { HOME: home, PATH: process.env.PATH },
    input,
    encoding: "utf8",
  });
}
test("the fake uses injected status commands and outputs", () => {
  const profile = {
    ...exampleAgentProfile,
    status: {
      args: ["check", "login"],
      signedIn: { stdout: "yes!\n", exitCode: 0 },
      signedOut: { stdout: "no!\n", exitCode: 7 },
    },
  };
  const home = makeFakeCodexHome({ profile, signedIn: false });
  homes.push(home);
  const result = run(home, profile.status.args);
  expect(result.stdout).toBe("no!\n");
  expect(result.status).toBe(7);
  expect(run(home, exampleAgentProfile.status.args).status).toBe(3);
});
test("the fake replays injected events and records exact run arguments and stdin", () => {
  const profile = { ...exampleAgentProfile, run: ["perform", "--stream"] };
  const home = makeFakeCodexHome({
    profile,
    events: [{ type: "started" }, { type: "result", text: "done" }],
  });
  homes.push(home);
  const args = [...profile.run, "-s", "workspace-write", "-m", "example-model"];
  const result = run(home, args, "synthetic prompt");
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('{"type":"started"}\n{"type":"result","text":"done"}\n');
  expect(readFakeCodexCalls(home)).toEqual([
    { kind: "call", args, cwd: home, env: ["HOME", "PATH"], prompt: "synthetic prompt" },
  ]);
});

test("the fake answers the injected model list command", () => {
  const profile = { ...exampleAgentProfile, modelsCommand: ["catalog", "models"] };
  const home = makeFakeCodexHome({ profile });
  homes.push(home);
  const result = run(home, ["catalog", "models"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("example-model\nexample-fast\n");
});
