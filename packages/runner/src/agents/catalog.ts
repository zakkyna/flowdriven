export type AgentId = "claude-code" | "codex";
export type AgentCommand = { program: string; args: string[] };
export type CatalogEntry = {
  id: AgentId;
  name: string;
  maker: string;
  binary: string;
  install: AgentCommand;
  signIn: AgentCommand;
  status: AgentCommand;
  modelsCommand?: AgentCommand | null;
  risk: "gray" | "official";
  noteKey: string;
  accountKey: string;
  lowestVersion: string;
  models: Record<
    string,
    {
      id: string;
      name: string;
      note: "mostCapable" | "fastCapable" | "fastest" | "allRound" | "carefulCoding";
      isDefault: boolean;
    }[]
  >;
};
export const AGENT_CATALOG: CatalogEntry[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    maker: "Anthropic",
    binary: "claude",
    install: { program: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
    signIn: { program: "claude", args: ["auth", "login"] },
    status: { program: "claude", args: ["auth", "status", "--json"] },
    modelsCommand: null,
    risk: "gray",
    noteKey: "agents.riskGray",
    accountKey: "agents.accountClaude",
    lowestVersion: "2.1.318",
    models: {
      "2.1.318": [
        { id: "opus-5.5", name: "Opus 5.5", note: "mostCapable", isDefault: false },
        { id: "sonnet-5.5", name: "Sonnet 5.5", note: "fastCapable", isDefault: true },
        { id: "haiku-5.5", name: "Haiku 5.5", note: "fastest", isDefault: false },
      ],
    },
  },
  {
    id: "codex",
    name: "Codex",
    maker: "OpenAI",
    binary: "codex",
    install: { program: "npm", args: ["install", "-g", "@openai/codex"] },
    signIn: { program: "codex", args: ["login"] },
    status: { program: "codex", args: ["login", "status"] },
    modelsCommand: null,
    risk: "official",
    noteKey: "agents.riskOfficial",
    accountKey: "agents.accountCodex",
    lowestVersion: "0.166.0",
    models: {
      "0.166.0": [
        { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", note: "allRound", isDefault: true },
        { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", note: "carefulCoding", isDefault: false },
        { id: "gpt-6-luna", name: "GPT-6 Luna", note: "fastest", isDefault: false },
      ],
    },
  },
];
