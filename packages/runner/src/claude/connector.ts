import type { RiskyAction } from "../states.ts";

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
