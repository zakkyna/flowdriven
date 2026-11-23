import { expect, test } from "vitest";
import { AgentState } from "./common.ts";
import { Settings } from "./settings.ts";

test("TC-j01-10 agent states and permission", async () => {
  const { Agent } = await import("./agents.ts");
  expect(Agent).toBeDefined();
  expect(AgentState.options).toEqual([
    "not_installed",
    "installing",
    "waiting_login",
    "needs_login",
    "ready",
    "unknown",
  ]);
  for (const value of ["unset", "on", "off", "yes"])
    expect(Settings.shape.agentPermission.safeParse(value).success).toBe(value !== "yes");
});
test("TC-CON-21 agent and one default model", async () => {
  const { Agent, AgentModels } = await import("./agents.ts");
  const agent = {
    id: "claude-code",
    name: "Claude Code",
    maker: "Anthropic",
    state: "ready",
    accountLine: { key: "agents.accountClaude" },
    risk: "gray",
    riskNote: { key: "agents.riskGray" },
    canSetUp: true,
    billing: "plan",
    capability: { tier: "enforced", accountTools: true },
  };
  for (const value of [
    agent,
    { ...agent, state: "waiting_login" },
    { ...agent, risk: "official" },
    { ...agent, capability: { tier: "folder_limited", accountTools: true } },
  ])
    expect(Agent.safeParse(value).success).toBe(true);
  for (const value of [
    { ...agent, state: "signed_out" },
    { ...agent, risk: "safe" },
  ])
    expect(Agent.safeParse(value).success).toBe(false);
  const models = [
    { id: "sonnet-5.5", name: "Sonnet 5.5", note: "fastCapable", isDefault: true },
    { id: "opus-5.5", name: "Opus 5.5", note: "mostCapable", isDefault: false },
  ];
  expect(AgentModels.safeParse(models).success).toBe(true);
  for (const value of [
    [],
    models.map((m) => ({ ...m, isDefault: true })),
    models.map((m) => ({ ...m, isDefault: false })),
    [{ ...models[0], note: "cheap" }],
  ])
    expect(AgentModels.safeParse(value).success).toBe(false);
});

test("TC-j01-10 agent operations and strict agent id", async () => {
  const { operations } = await import("./operations.ts");
  for (const name of ["agents.setUp", "agents.signIn"] as const) {
    expect(operations[name].input.safeParse({ agentId: "codex" }).success).toBe(true);
    for (const input of [{}, { agentId: "has space" }, { agentId: "codex", password: "x" }])
      expect(operations[name].input.safeParse(input).success).toBe(false);
    expect(operations[name].mcp).toBe("no");
  }
  expect(operations["agents.rescan"].mcp).toBe("no");
  expect(operations["agents.list"].reads).toContain("agents");
  expect(operations["agents.setUp"].writes).toEqual(["agents", "settings"]);
});

test.each(["memory_on", "own_instruction_files"])("B-07.T8 accepts memory gap %s", async (memoryGap) => {
  const { Agent } = await import("./agents.ts");
  const capability = { tier: "enforced", accountTools: true, memoryGap };
  expect(Agent.shape.capability.safeParse(capability).success).toBe(true);
});

test("B-07.T8 accepts no memory gap and rejects other values", async () => {
  const { Agent } = await import("./agents.ts");
  const capability = { tier: "enforced", accountTools: true };
  expect(Agent.shape.capability.safeParse(capability).success).toBe(true);
  expect(Agent.shape.capability.safeParse({ ...capability, memoryGap: "other" }).success).toBe(false);
});
