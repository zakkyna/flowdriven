import { DEFAULT_KEEPER, type Settings } from "@flowdriven/contracts/v1";
export function settings(): Settings {
  return {
    brain: {
      main: "codex-cli",
      subscriptionOrder: ["codex-cli", "claude-cli"],
      apiKeyOrder: ["anthropic-api"],
    },
    backends: [
      {
        id: "codex-cli",
        name: "Codex CLI",
        kind: "harness",
        risk: "official",
        available: true,
        login: "logged_in",
        quota: "available",
        consent: "not_needed",
      },
      {
        id: "claude-cli",
        name: "Claude Code CLI",
        kind: "harness",
        risk: "gray",
        available: true,
        login: "logged_in",
        quota: "exhausted",
        consent: "given",
      },
      {
        id: "agy-cli",
        name: "Antigravity CLI",
        kind: "harness",
        risk: "unofficial",
        available: true,
        login: "unknown",
        quota: "unknown",
        consent: "not_given",
      },
      {
        id: "anthropic-api",
        name: "Anthropic API key",
        kind: "api_key",
        risk: "official",
        available: true,
        login: "unknown",
        quota: "available",
        consent: "not_needed",
        keyStored: true,
      },
      {
        id: "openai-api",
        name: "OpenAI API key",
        kind: "api_key",
        risk: "official",
        available: false,
        login: "unknown",
        quota: "unknown",
        consent: "not_needed",
        keyStored: false,
      },
    ],
    budget: { month: "2026-11", capUsd: 20, perRunCapUsd: 5, spentUsd: 16.4 },
    offerSaveOneTime: true,
    keeper: { ...structuredClone(DEFAULT_KEEPER), ceiling: 4 },
  };
}
export function emptySettings(): Settings {
  return {
    brain: { main: null, subscriptionOrder: [], apiKeyOrder: [] },
    backends: [],
    budget: { month: "2026-11", capUsd: 0, perRunCapUsd: null, spentUsd: 0 },
    offerSaveOneTime: true,
    keeper: { ...structuredClone(DEFAULT_KEEPER), ceiling: 4 },
  };
}
