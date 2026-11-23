import { mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { AGENT_PROFILES } from "../test-helpers/agent-profiles.ts";
import {
  FAKE_CLAUDE_PATH,
  FAKE_HELP,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { FAKE_CODEX_PATH, writeFakeCodexScript } from "../test-helpers/fake-codex-script.ts";
import { createRunnerService } from "./service.ts";

async function fixture(timeoutMs?: number) {
  const home = makeFakeHome();
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  const store = await openSqliteStore(":memory:");
  let ms = Date.parse("2026-11-23T00:00:00Z");
  const topics: string[] = [];
  const opened: string[] = [];
  const fs = {
    statSync,
    openSync: ((path: string) => {
      opened.push(path);
      throw new Error("unexpected open");
    }) as typeof import("node:fs").openSync,
  };
  const service = createRunnerService({
    store,
    dataDir: home,
    mode: "demo",
    env: { HOME: home, PATH: `${bin}:${process.env.PATH}` },
    now: () => new Date(ms),
    agents: { timeoutMs, fs, extraDirs: [], claudePath: join(bin, "claude"), codexPath: join(bin, "codex") },
    markChanged: (topic) => topics.push(topic),
  });
  return {
    home,
    store,
    service,
    topics,
    opened,
    advance(n: number) {
      ms += n;
    },
    close() {
      service.stop();
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("TC-AGT-02 list caches detection and refreshes status", async () => {
  const f = await fixture();
  try {
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { id: "claude-code", state: "ready", canSetUp: true },
      { id: "codex", state: "not_installed", canSetUp: true, installCommand: expect.any(String) },
    ]);
    const calls = readFakeCalls(f.home).length;
    f.advance(10_000);
    await f.service.call("agents.list", {});
    expect(readFakeCalls(f.home)).toHaveLength(calls);
    f.advance(51_000);
    await f.service.call("agents.list", {});
    await expect.poll(() => readFakeCalls(f.home).length).toBe(calls + 1);
    expect(f.topics).toContain("agents");
  } finally {
    f.close();
  }
});

test("TC-AGT-03 billing retains only the method", async () => {
  const f = await fixture();
  try {
    for (const [auth, billing, state] of [
      [{ loggedIn: true, authMethod: "subscription" }, "plan", "ready"],
      [{ loggedIn: true, authMethod: "api_key" }, "per_use", "ready"],
      [{ raw: "invalid" }, "unknown", "unknown"],
    ] as const) {
      writeFakeScript(f.home, { auth });
      expect(await f.service.call("agents.rescan", {})).toMatchObject({
        agents: [{ billing, state }, { state: "not_installed" }],
      });
      expect(f.store.getHarnessState("claude-code")).toMatchObject({ billing, state });
    }
  } finally {
    f.close();
  }
});

test("TC-AGT-04 detection maps missing, signed-out, ready, old and unreadable", async () => {
  const f = await fixture();
  try {
    for (const [script, state, code] of [
      [{ auth: { loggedIn: false } }, "needs_login", undefined],
      [{}, "ready", undefined],
      [{ help: FAKE_HELP.replace("--json-schema\n", "") }, "unknown", "too_old"],
      [{ auth: { raw: "invalid" } }, "unknown", "unreadable"],
    ] as const) {
      writeFakeScript(f.home, script);
      const result = await f.service.call("agents.rescan", {});
      expect(result).toMatchObject({
        agents: [code ? { state, problem: { code } } : { state }, { state: "not_installed" }],
      });
    }
  } finally {
    f.close();
  }
});

test("TC-SR6-07 detection never opens sign-in files or stores account details", async () => {
  const f = await fixture();
  try {
    mkdirSync(join(f.home, ".claude"));
    mkdirSync(join(f.home, ".codex"));
    writeFileSync(join(f.home, ".claude", ".credentials.json"), "sentinel");
    writeFileSync(join(f.home, ".codex", "auth.json"), "sentinel");
    writeFakeScript(f.home, {
      auth: { raw: '{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.test"}' },
    });
    symlinkSync(FAKE_CODEX_PATH, join(f.home, "bin", "codex"));
    const profile = {
      ...AGENT_PROFILES.codex,
      status: {
        ...AGENT_PROFILES.codex.status,
        signedIn: { stdout: '{"authMethod":"subscription","email":"sam@example.test"}', exitCode: 0 },
      },
    };
    writeFakeCodexScript(f.home, { profile });
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { state: "ready", billing: "plan" },
      { state: "ready", billing: "plan" },
    ]);
    await f.service.call("agents.rescan", {});
    expect(JSON.stringify(f.store.getHarnessState("claude-code"))).not.toContain("sam@example.test");
    expect(JSON.stringify(f.store.getHarnessState("claude-code"))).not.toContain("sentinel");
    expect(JSON.stringify(f.store.getHarnessState("codex"))).not.toContain("sam@example.test");
    expect(f.opened).not.toContain(join(f.home, ".claude", ".credentials.json"));
    expect(f.opened).not.toContain(join(f.home, ".codex", "auth.json"));
  } finally {
    f.close();
  }
});

test("TC-AGT-02 a hanging version probe returns unknown within the deadline", async () => {
  const f = await fixture(200);
  try {
    writeFakeScript(f.home, { hang: ["version"] });
    const started = performance.now();
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { state: "unknown", problem: { code: "unreadable" } },
      { state: "not_installed" },
    ]);
    expect(performance.now() - started).toBeLessThan(15000);
  } finally {
    f.close();
  }
});

test("TC-AGT-04 Codex version and status use its catalog command", async () => {
  const f = await fixture();
  try {
    symlinkSync(FAKE_CODEX_PATH, join(f.home, "bin", "codex"));
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: true });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [
        { state: "ready" },
        {
          state: "ready",
          version: "0.166.0",
          billing: "unknown",
          capability: { tier: "label_only", accountTools: false },
        },
      ],
    });
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: false });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [{ state: "ready" }, { state: "needs_login" }],
    });
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, version: "unreadable" });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [{ state: "ready" }, { state: "unknown", problem: { code: "unreadable" } }],
    });
  } finally {
    f.close();
  }
});

test("TC-AGT-11 scan again finds only newly installed agents", async () => {
  const f = await fixture();
  try {
    expect(await f.service.call("agents.rescan", {})).toMatchObject({ found: [] });
    symlinkSync(FAKE_CODEX_PATH, join(f.home, "bin", "codex"));
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: true });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({ found: ["codex"] });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({ found: [] });
    expect(f.topics).toContain("agents");
  } finally {
    f.close();
  }
});

test("TC-AGT-11 an unknown installed agent is found on scan", async () => {
  const f = await fixture();
  try {
    writeFakeScript(f.home, { auth: { raw: "invalid" } });
    await f.service.call("agents.list", {});
    expect(f.store.getHarnessState("claude-code")?.state).toBe("unknown");
    writeFakeScript(f.home, { auth: { loggedIn: true } });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({ found: ["claude-code"] });
  } finally {
    f.close();
  }
});
