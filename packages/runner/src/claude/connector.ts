import type { Value } from "@flowdriven/sdk";
import { callGrant, digestCall, pickGrant } from "../connectors/grants.ts";
import type { HeldCall } from "../harness.ts";
import type { RiskyAction } from "../states.ts";
import { visible } from "./text.ts";

export type ConnectorPolicy = {
  requirementId: string;
  label: string;
  name: string;
  url: string;
  id: string;
  prefix: string;
  tools: string[];
  read: string[];
  risky: Record<string, RiskyAction>;
  blocked: string[];
};
export const CONNECTOR_DENY = {
  held: "FlowDriven is holding this call until the owner approves it.",
  tooLarge: "This connector call is too large.",
  tooMany: "This step called the connector too many times.",
};
export const CONNECTOR_STOP = {
  down: (label: string) =>
    `The ${label} connector is not connected in Claude Code. Scan again on the Harnesses screen.`,
  changed: "The connector's tools changed since the last scan. Scan again on the Harnesses screen.",
};
export const MAX_CONNECTOR_CALLS = 20;
export const MAX_CONNECTOR_INPUT_BYTES = 16_000;
export type ConnectorAllow = {
  requirementId: string;
  tool: string;
  class: "read" | "risky";
  grant?: { kind: "pick" | "call"; key: string };
};
export type ConnectorState = { calls: number; granted: (grant: string) => boolean };

export function decideConnector(
  connector: ConnectorPolicy,
  name: string,
  input: Record<string, unknown>,
  state: ConnectorState,
): { allow: true; connector: ConnectorAllow } | { allow: false; reason: string; held?: HeldCall } {
  const undeclared = () => ({
    allow: false as const,
    reason: `This step does not declare the tool ${visible(connector.prefix + name, 60)}.`,
  });
  if (!connector.tools.includes(name)) return undeclared();
  let text: string;
  try {
    const encoded = JSON.stringify(input);
    if (encoded === undefined || Buffer.byteLength(encoded) > MAX_CONNECTOR_INPUT_BYTES)
      return { allow: false, reason: CONNECTOR_DENY.tooLarge };
    text = encoded;
  } catch {
    return { allow: false, reason: CONNECTOR_DENY.tooLarge };
  }
  if (state.calls >= MAX_CONNECTOR_CALLS) return { allow: false, reason: CONNECTOR_DENY.tooMany };
  if (connector.read.includes(name))
    return { allow: true, connector: { requirementId: connector.requirementId, tool: name, class: "read" } };
  const action = Object.hasOwn(connector.risky, name) ? connector.risky[name] : undefined;
  if (action === undefined) return undeclared();
  const pick = pickGrant(connector.requirementId, name);
  if (state.granted(pick))
    return {
      allow: true,
      connector: {
        requirementId: connector.requirementId,
        tool: name,
        class: "risky",
        grant: { kind: "pick", key: pick },
      },
    };
  const copy = JSON.parse(text) as Value;
  const digest = digestCall(name, copy);
  const key = callGrant(connector.requirementId, name, digest);
  if (state.granted(key))
    return {
      allow: true,
      connector: {
        requirementId: connector.requirementId,
        tool: name,
        class: "risky",
        grant: { kind: "call", key },
      },
    };
  return {
    allow: false,
    reason: CONNECTOR_DENY.held,
    held: { requirementId: connector.requirementId, tool: name, input: copy, digest, action },
  };
}
export function mcpConfigText(connector: ConnectorPolicy): string {
  return JSON.stringify({
    mcpServers: {
      [connector.name]: {
        type: "claudeai-proxy",
        url: connector.url,
        id: connector.id,
        toolPermissions: Object.fromEntries(connector.blocked.map((tool) => [tool, "blocked"])),
      },
    },
  });
}
