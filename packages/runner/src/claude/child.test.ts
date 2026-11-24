import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  FAKE_CLAUDE_PATH,
  type FakeScript,
  makeFakeHome,
  readFakeCalls,
} from "../test-helpers/fake-claude-script.ts";
import { startChild } from "./child.ts";

const homes: string[] = [];
function setup(script: FakeScript, killGroup?: (pid: number, signal: NodeJS.Signals) => void) {
  const h = makeFakeHome(script);
  homes.push(h);
  const settings = join(h, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ command: "true" }] }],
        PreToolUse: [{ hooks: [{ command: "exit 2", timeout: 1 }] }],
      },
    }),
  );
  const child = startChild(FAKE_CLAUDE_PATH, ["-p", "--settings", settings], {
    cwd: h,
    env: { HOME: h, PATH: process.env.PATH ?? "" },
    ...(killGroup ? { killGroup } : { graceMs: 200 }),
  });
  child.send("hello");
  return { h, child };
}
async function waitInit(h: string) {
  for (let i = 0; i < 100; i++) {
    if (readFakeCalls(h).some((call) => call.kind === "init")) {
      await new Promise((r) => setTimeout(r, 100));
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("fake did not start");
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
test("stop() sends SIGTERM and then SIGKILL after the grace to a child that ignores SIGTERM", {
  timeout: 20_000,
}, async () => {
  const { h, child } = setup({
    plays: [{ when: "", actions: [{ do: "ignore_sigterm" }, { do: "pause", ms: 30000 }] }],
  });
  await waitInit(h);
  const pid = child.pid;
  expect(pid).toBeTypeOf("number");
  if (pid === undefined) throw new Error("missing pid");
  const start = performance.now();
  child.stop();
  expect((await child.done).signal).toBe("SIGKILL");
  expect(performance.now() - start).toBeLessThan(3000);
  expect(() => process.kill(pid, 0)).toThrow();
});
test("kill() ends the group at once and stderrTail keeps only the last 65,536 bytes", {
  timeout: 20_000,
}, async () => {
  const first = setup({
    plays: [{ when: "", actions: [{ do: "exit", code: 1, stderr: "x".repeat(100000) }] }],
  });
  await first.child.done;
  expect(Buffer.byteLength(first.child.stderrTail())).toBe(65536);
  const second = setup({ plays: [{ when: "", actions: [{ do: "pause", ms: 30000 }] }] });
  await waitInit(second.h);
  second.child.kill();
  expect((await second.child.done).signal).toBe("SIGKILL");
});
test("done resolves on close: every byte of standard output has arrived", { timeout: 20_000 }, async () => {
  const { child } = setup({
    plays: [
      {
        when: "",
        init: false,
        startHook: false,
        actions: [
          { do: "raw", line: "x".repeat(300000) },
          { do: "exit", code: 0 },
        ],
      },
    ],
  });
  let bytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
  });
  await child.done;
  expect(bytes).toBe(300001);
});

test("TC-SR8-01 default stop signals the process group with a one-second grace", {
  timeout: 20_000,
}, async () => {
  const signals: string[] = [];
  const { h, child } = setup(
    { plays: [{ when: "", actions: [{ do: "ignore_sigterm" }, { do: "pause", ms: 30000 }] }] },
    (pid, signal) => {
      signals.push(signal);
      process.kill(-pid, signal);
    },
  );
  try {
    await waitInit(h);
    const started = performance.now();
    child.stop();
    expect(signals).toEqual(["SIGTERM"]);
    await child.done;
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(performance.now() - started).toBeLessThan(1500);
  } finally {
    child.kill();
  }
});
