import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createRunnerService } from "../service/service.ts";
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

async function fixture(installed = false) {
  const home = makeFakeHome();
  const bin = join(home, "bin");
  mkdirSync(bin);
  if (installed) symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  const store = await openSqliteStore(":memory:");
  const topics: string[] = [];
  let instant = Date.parse("2026-11-23T00:00:00Z");
  const spawnInstall = vi.fn();
  const service = createRunnerService({
    store,
    dataDir: home,
    mode: "demo",
    env: { HOME: home, PATH: `${bin}:${process.env.PATH}` },
    now: () => new Date(instant),
    agents: { spawnInstall, extraDirs: [], claudePath: join(bin, "claude"), codexPath: join(bin, "codex") },
    markChanged: (topic) => topics.push(topic),
  });
  return {
    home,
    bin,
    store,
    service,
    topics,
    spawnInstall,
    advance(ms: number) {
      instant += ms;
    },
    close() {
      service.stop();
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("TC-j01-05 detection does not install or change permission", async () => {
  const f = await fixture();
  try {
    const agents = await f.service.call("agents.list", {});
    expect(agents).toMatchObject([
      { id: "claude-code", state: "not_installed" },
      { id: "codex", state: "not_installed" },
    ]);
    expect(await f.service.call("agents.list", {})).toEqual(agents);
    expect(await f.service.call("agents.rescan", {})).toMatchObject({ agents });
    expect(await f.service.call("settings.get", {})).toMatchObject({ agentPermission: "unset" });
    expect(f.spawnInstall).not.toHaveBeenCalled();
    expect(readFakeCalls(f.home)).toEqual([]);
    expect(f.store.listAudit().some((row) => row.kind === "permission_changed")).toBe(false);
  } finally {
    f.close();
  }
});

test("TC-j01-18 rescan discovers an installed agent and marks the topic", async () => {
  const f = await fixture();
  try {
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { state: "not_installed" },
      { state: "not_installed" },
    ]);
    symlinkSync(FAKE_CLAUDE_PATH, join(f.bin, "claude"));
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [{ state: "ready" }, { state: "not_installed" }],
    });
    expect(f.topics).toContain("agents");
    expect(await f.service.call("settings.get", {})).toMatchObject({ agentPermission: "unset" });
  } finally {
    f.close();
  }
});

test("TC-j01-25 unreadable status and missing required flag are unknown", async () => {
  const f = await fixture(true);
  try {
    writeFakeScript(f.home, { auth: { raw: "not json {" } });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [{ state: "unknown", problem: { code: "unreadable" } }, { state: "not_installed" }],
    });
    writeFakeScript(f.home, { help: FAKE_HELP.replace("--json-schema\n", "") });
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [{ state: "unknown", problem: { code: "too_old" } }, { state: "not_installed" }],
    });
    writeFakeScript(f.home, {});
    expect(await f.service.call("agents.rescan", {})).toMatchObject({
      agents: [{ state: "ready" }, { state: "not_installed" }],
    });
  } finally {
    f.close();
  }
});

test("TC-AGT-01 catalog has safe commands and both agents", async () => {
  const { AGENT_CATALOG } = await import("./registry.ts");
  expect(AGENT_CATALOG.map((entry) => entry.id)).toEqual(["claude-code", "codex"]);
  for (const entry of AGENT_CATALOG) {
    expect(entry).toMatchObject({
      name: expect.any(String),
      maker: expect.any(String),
      binary: expect.any(String),
      risk: expect.any(String),
      noteKey: expect.any(String),
      accountKey: expect.any(String),
      lowestVersion: expect.any(String),
      models: expect.any(Object),
    });
    if (!entry.install) throw new Error("Expected the shipped installer (TC-AGT-01).");
    for (const command of [entry.install, entry.signIn, entry.status]) {
      expect(command).toMatchObject({ program: expect.any(String), args: expect.any(Array) });
      expect([command.program, ...command.args].join(" ")).not.toMatch(
        /[;|&`]|\$\(|--yolo|--full-auto|bypass/i,
      );
    }
    expect(["sh", "bash", "zsh", "cmd", "curl", "env"]).not.toContain(entry.install.program);
  }
});

test("TC-AGT-04 Claude adapter detects before a control directory exists", async () => {
  const f = await fixture(true);
  try {
    const { createClaudeAdapter } = await import("../claude/adapter.ts");
    const adapter = createClaudeAdapter({
      controlRoot: join(f.home, "control"),
      claudePath: () => join(f.bin, "claude"),
      env: () => ({ HOME: f.home, PATH: `${f.bin}:${process.env.PATH}` }),
      audit: () => {},
      newId: (prefix) => prefix,
    });
    expect(await adapter.detect()).toMatchObject({ state: "ready", version: "2.1.318" });
    expect(await adapter.signInStatus()).toMatchObject({ state: "ready", billing: "plan" });
    adapter.stop?.();
  } finally {
    f.close();
  }
});

test("TC-j01-18 detection searches only the injected PATH", async () => {
  const f = await fixture(true);
  symlinkSync(process.execPath, join(f.bin, "node"));
  const service = createRunnerService({
    store: f.store,
    dataDir: f.home,
    mode: "demo",
    env: { HOME: f.home, PATH: f.bin },
    agents: { extraDirs: [] },
  });
  try {
    expect(await service.call("agents.list", {})).toMatchObject([
      { id: "claude-code", state: "ready" },
      { id: "codex", state: "not_installed" },
    ]);
  } finally {
    service.stop();
    f.close();
  }
});

test("TC-j01-25 a status refresh cannot make an unsupported agent ready", async () => {
  const f = await fixture(true);
  try {
    writeFakeScript(f.home, { help: FAKE_HELP.replace("--json-schema\n", "") });
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { state: "unknown", problem: { code: "too_old" } },
      { state: "not_installed" },
    ]);
    await expect(
      f.service.call("settings.update", {
        patch: { mainAgent: { agent: "claude-code", model: "sonnet-5.5" } },
      }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "agent_not_ready" });
    expect(await f.service.call("settings.get", {})).toMatchObject({ mainAgent: null });
    const before = f.topics.length;
    f.advance(61000);
    await f.service.call("agents.list", {});
    await expect.poll(() => f.topics.length).toBeGreaterThan(before);
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { state: "unknown", problem: { code: "too_old" } },
      { state: "not_installed" },
    ]);
  } finally {
    f.close();
  }
});

test("TC-AGT-29 main agent requires a ready agent and a listed model", async () => {
  const f = await fixture(true);
  try {
    symlinkSync(FAKE_CODEX_PATH, join(f.bin, "codex"));
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: false });
    await f.service.call("agents.rescan", {});
    await expect(
      f.service.call("settings.update", { patch: { mainAgent: { agent: "codex", model: "gpt-6.1-terra" } } }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "agent_not_ready" });
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: true });
    await f.service.call("agents.rescan", {});
    await expect(
      f.service.call("settings.update", { patch: { mainAgent: { agent: "codex", model: "gpt-6.1-nova" } } }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "model_unknown" });
    expect(
      await f.service.call("settings.update", {
        patch: { mainAgent: { agent: "claude-code", model: "opus-5.5" } },
      }),
    ).toMatchObject({ mainAgent: { agent: "claude-code", model: "opus-5.5" } });
    expect(await f.service.call("settings.get", {})).toMatchObject({
      mainAgent: { agent: "claude-code", model: "opus-5.5" },
    });
    await expect(f.service.call("settings.update", { patch: { busyFallback: "yes" } })).rejects.toMatchObject(
      { code: "invalid_input" },
    );
  } finally {
    f.close();
  }
});
