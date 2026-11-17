export type Enforcer =
  | "FlowDriven"
  | "FlowDriven hook in Claude Code"
  | "Claude Code's settings"
  | "not enforced";
export type Route = {
  routed: true;
  requirementId: string;
  type: string;
  provider:
    | "claude-code-commands"
    | "claude-code-files"
    | "claude-in-chrome"
    | "claude-ai-connector"
    | "flowdriven-skill";
  providerName: string;
  enforcedBy: Enforcer;
  label: "official" | "gray" | "unofficial";
  labelSentence?: string;
  away: boolean;
};
export type Dropped = { routed: false; requirementId: string; type: string; noun: string; reason: string };
export type Routed = Route | Dropped;
export type FactConnector = {
  name: string;
  url: string;
  status: string;
  tools: { name: string; readOnly: boolean }[];
};
export type HarnessFacts = {
  hooks: boolean;
  chrome: boolean;
  connectors?: FactConnector[];
  skills?: string[];
};
