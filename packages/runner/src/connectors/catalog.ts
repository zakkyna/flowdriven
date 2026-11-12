import type { RiskyAction } from "../states.ts";

export type ConnectorEntry = {
  ref: string;
  name: string;
  url: string;
  prefix: string;
  label: string;
  read: string[];
  risky: Record<string, RiskyAction>;
};

export const CONNECTORS: ConnectorEntry[] = [
  {
    ref: "connector:gmail",
    name: "claude.ai Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    prefix: "mcp__claude_ai_Gmail__",
    label: "Gmail",
    read: ["search_threads", "get_thread", "get_message", "list_labels", "list_drafts", "get_draft"],
    risky: {
      send_message: "send",
      reply: "send",
      forward: "send",
      trash_thread: "delete",
      trash_message: "delete",
      delete_draft: "delete",
      delete_label: "delete",
    },
  },
];

export function catalogEntry(
  ref: string | undefined,
  catalog: ConnectorEntry[] = CONNECTORS,
): ConnectorEntry | undefined {
  return catalog.find((entry) => entry.ref === ref);
}
