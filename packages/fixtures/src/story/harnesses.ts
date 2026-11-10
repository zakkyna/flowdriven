import type { HarnessCard, InventoryItem } from "@flowdriven/contracts";
export function harnesses(): HarnessCard[] {
  function card(
    id: string,
    name: string,
    binary: string,
    risk: HarnessCard["risk"],
    detected: boolean,
  ): HarnessCard {
    return {
      id,
      name,
      binary,
      detected,
      login: detected ? "logged_in" : "unknown",
      risk,
      vendorProhibited: false,
      consent: risk === "official" ? "not_needed" : "not_given",
      sandbox: "none",
      adapter: "detection_only",
      quota: { state: "unknown", today: { calls: 0 }, week: { calls: 0 } },
      inventory: { supported: false, skills: [], plugins: [], mcpServers: [] },
    };
  }
  const codex = card("codex", "Codex", "codex", "official", true);
  Object.assign(codex, {
    path: "/opt/homebrew/bin/codex",
    version: "0.71.0",
    sandbox: "os",
    adapter: "full",
    quota: {
      state: "available",
      today: { calls: 14 },
      week: { calls: 96 },
      note: "ChatGPT plan usage is shared across apps, so the brain and workers draw from the same allowance.",
    },
    inventory: {
      supported: true,
      skills: [{ name: "flutter-from-figma", scope: "project" }],
      plugins: [],
      mcpServers: [{ name: "figma", scope: "user", connection: "connected" }],
    },
  });
  const claude = card("claude-code", "Claude Code", "claude", "gray", true);
  const skills: InventoryItem[] = ["report-writing", "review", "planning"].map((name) => ({
    name,
    scope: "user",
  }));
  Object.assign(claude, {
    path: "~/.local/bin/claude",
    version: "2.4.1",
    riskNote: "Gray on a plan login, official with an API key.",
    consent: "given",
    sandbox: "os",
    adapter: "full",
    quota: {
      state: "exhausted",
      until: "2026-11-10T13:00:00.000Z",
      today: { calls: 31 },
      week: { calls: 210 },
    },
    inventory: {
      supported: true,
      skills,
      plugins: [
        { name: "documents", scope: "user" },
        { name: "development", scope: "user" },
      ],
      mcpServers: [
        { name: "gmail", scope: "user", connection: "connected" },
        { name: "figma", scope: "user", connection: "needs_login" },
        { name: "sheets", scope: "user", connection: "failed" },
      ],
    },
  });
  const agy = card("antigravity", "Antigravity", "agy", "unofficial", true);
  Object.assign(agy, {
    path: "/opt/homebrew/bin/agy",
    version: "1.9.0",
    vendorProhibited: true,
    adapter: "full",
    consentText:
      "Google's FAQ says wrapping agy in third-party apps is not supported, and its terms call it a breach that can lead to suspension.",
    login: "unknown",
  });
  const open = card("opencode", "OpenCode", "opencode", "gray", true);
  Object.assign(open, {
    path: "/opt/homebrew/bin/opencode",
    version: "0.15.2",
    riskNote: "Not researched yet; treated as gray until checked.",
    consentText: "OpenCode's terms have not been checked yet. FlowDriven treats it as gray until they are.",
  });
  const copilot = card("copilot", "Copilot CLI", "copilot", "gray", false);
  copilot.riskNote = "Not researched yet; treated as gray until checked.";
  const gemini = card("gemini", "Gemini CLI", "gemini", "gray", false);
  gemini.riskNote = "Gray, leaning prohibited.";
  return [codex, claude, agy, open, copilot, gemini];
}
