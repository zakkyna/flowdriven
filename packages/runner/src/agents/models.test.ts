import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Agent, AgentModels } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createRunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { AGENT_PROFILES } from "../test-helpers/agent-profiles.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import {
  FAKE_CODEX_PATH,
  readFakeCodexCalls,
  writeFakeCodexScript,
} from "../test-helpers/fake-codex-script.ts";
import { AGENT_CATALOG } from "./catalog.ts";

async function fixture() {
  const home = makeFakeHome();
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  const store = await openSqliteStore(":memory:");
  const catalog = structuredClone(AGENT_CATALOG);
  const service = createRunnerService({
    store,
    dataDir: home,
    mode: "demo",
    env: { HOME: home, PATH: process.env.PATH },
    agents: { catalog, extraDirs: [], claudePath: join(bin, "claude"), codexPath: join(bin, "codex") },
  });
  return {
    home,
    store,
    service,
    catalog,
    close() {
      service.stop();
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
test("TC-AGT-13 each ready agent reports its catalog models", async () => {
  const f = await fixture();
  try {
    const models = AgentModels.parse(await f.service.call("agents.models", { agentId: "claude-code" }));
    expect(models.map((m) => m.id)).toEqual(["opus-5.5", "sonnet-5.5", "haiku-5.5"]);
    expect(models.filter((m) => m.isDefault).map((m) => m.id)).toEqual(["sonnet-5.5"]);
    expect(f.store.getHarnessState("claude-code")).toMatchObject({ models: { source: "catalog" } });
    expect(await f.service.call("agents.list", {})).toMatchObject([
      { models, defaultModel: "sonnet-5.5" },
      { state: "not_installed" },
    ]);
  } finally {
    f.close();
  }
});
test("TC-AGT-14 errors, cache and rescan remove a vanished model", async () => {
  const f = await fixture();
  try {
    symlinkSync(FAKE_CODEX_PATH, join(f.home, "bin", "codex"));
    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: false });
    await expect(f.service.call("agents.models", { agentId: "gemini" })).rejects.toMatchObject({
      code: "not_found",
      reason: "agent_unknown",
    });
    await expect(f.service.call("agents.models", { agentId: "codex" })).rejects.toMatchObject({
      code: "not_allowed",
      reason: "agent_not_ready",
    });
    const agents = Agent.array().parse(await f.service.call("agents.list", {}));
    expect(agents).toMatchObject([{ state: "ready" }, { state: "needs_login" }]);
    expect(agents[1]).not.toHaveProperty("models");
    expect(agents[1]).not.toHaveProperty("defaultModel");
    const before = await f.service.call("agents.models", { agentId: "claude-code" });
    const claude = f.catalog.find((entry) => entry.id === "claude-code");
    if (!claude) throw new Error("missing catalog");
    claude.models["2.1.318"] = (claude.models["2.1.318"] ?? []).filter((m) => m.id !== "opus-5.5");
    expect(await f.service.call("agents.models", { agentId: "claude-code" })).toEqual(before);
    await f.service.call("agents.rescan", {});
    expect(
      AgentModels.parse(await f.service.call("agents.models", { agentId: "claude-code" })).map((m) => m.id),
    ).not.toContain("opus-5.5");
  } finally {
    f.close();
  }
});

test("TC-AGT-13 agent list, catalog fallback, version and invalid ids", async () => {
  const f = await fixture();
  try {
    symlinkSync(FAKE_CODEX_PATH, join(f.home, "bin", "codex"));
    const codex = f.catalog.find((entry) => entry.id === "codex");
    const claude = f.catalog.find((entry) => entry.id === "claude-code");
    if (!codex || !claude) throw new Error("missing catalog");
    codex.modelsCommand = { program: join(f.home, "bin", "codex"), args: ["models"] };
    const profile = {
      ...AGENT_PROFILES.codex,
      modelsCommand: ["models"],
      models: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "-invalid"],
    };
    writeFakeCodexScript(f.home, { profile });
    const models = AgentModels.parse(await f.service.call("agents.models", { agentId: "codex" }));
    expect(models.map((model) => model.id)).toEqual(profile.models.slice(0, 3));
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(["gpt-6.1-sol"]);
    expect(f.store.getHarnessState("codex")).toMatchObject({ models: { source: "agent" } });
    const count = readFakeCodexCalls(f.home).filter(
      (call) => call.args.join(" ") === profile.modelsCommand.join(" "),
    ).length;
    await f.service.call("agents.models", { agentId: "codex" });
    expect(
      readFakeCodexCalls(f.home).filter((call) => call.args.join(" ") === profile.modelsCommand.join(" ")),
    ).toHaveLength(count);
    writeFakeCodexScript(f.home, { profile: { ...profile, models: ["new-model"] } });
    await f.service.call("agents.rescan", {});
    expect(await f.service.call("agents.models", { agentId: "codex" })).toEqual([
      { id: "new-model", name: "new-model", note: "allRound", isDefault: true },
    ]);
    codex.modelsCommand = { program: join(f.home, "bin", "codex"), args: ["unknown"] };
    await f.service.call("agents.rescan", {});
    expect(await f.service.call("agents.models", { agentId: "codex" })).toEqual(codex.models["0.166.0"]);
    expect(f.store.getHarnessState("codex")).toMatchObject({ models: { source: "catalog" } });
  } finally {
    f.close();
  }
});
