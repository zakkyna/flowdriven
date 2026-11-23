import type { Agent } from "@flowdriven/contracts";
import type { createAgentRegistry } from "../agents/registry.ts";

type LocalAgent = Awaited<ReturnType<ReturnType<typeof createAgentRegistry>["list"]>>[number];
export function mapAgents(agents: LocalAgent[]): Agent[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    maker: agent.maker,
    state: agent.state,
    ...(agent.version === undefined ? {} : { version: agent.version }),
    accountLine: agent.accountLine,
    risk: agent.risk,
    riskNote: agent.riskNote,
    canSetUp: agent.canSetUp,
    ...(agent.installCommand === undefined ? {} : { installCommand: agent.installCommand }),
    billing: agent.billing,
    capability: agent.capability,
    ...(agent.problem === undefined ? {} : { problem: agent.problem }),
  }));
}
