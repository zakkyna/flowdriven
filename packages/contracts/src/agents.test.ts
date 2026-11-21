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
