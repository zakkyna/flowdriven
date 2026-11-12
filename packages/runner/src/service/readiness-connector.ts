import type { ConnectorEntry } from "../connectors/catalog.ts";

export function connectorReadiness(
  entry: ConnectorEntry,
  connectors: { name: string; url: string; status: string }[],
): { state: "ok" | "needs_login" | "missing"; detail: string } {
  const fact = connectors.find((c) => c.name === entry.name && c.url === entry.url);
  if (fact?.status === "connected")
    return { state: "ok", detail: `The ${entry.label} connector is connected in Claude Code.` };
  if (fact?.status === "needs_login")
    return {
      state: "needs_login",
      detail: `Sign in to ${entry.label} at claude.ai/customize/connectors, then scan again on the Harnesses screen.`,
    };
  return {
    state: "missing",
    detail: `Add the ${entry.label} connector at claude.ai/customize/connectors, then scan again on the Harnesses screen.`,
  };
}
