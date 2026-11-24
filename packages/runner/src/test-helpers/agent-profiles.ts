// Synthetic test data, written by hand; these are not real agent commands.
export type AgentProfile = {
  program: string;
  run: string[];
  sandboxFlag: string;
  sandbox: { workspaceWrite: string; readOnly: string; chat: string };
  modelFlag: string;
  resume: string[];
  refusedValues: string[];
  signIn: string[];
  status: {
    args: string[];
    signedIn: { stdout: string; exitCode: number };
    signedOut: { stdout: string; exitCode: number };
  };
  models: string[];
  modelsCommand: string[];
  install: { command: string; args: string[] };
  // Worker starts only: settings that turn off the person's own memory while FlowDriven's hooks stay on; `gap` names what could not be turned off.
  memoryOff?: { settings: Record<string, boolean>; gap?: string };
};

export const exampleAgentProfile: AgentProfile = {
  program: "example-agent",
  run: ["run", "--events"],
  sandboxFlag: "-s",
  sandbox: { workspaceWrite: "workspace-write", readOnly: "read-only", chat: "workspace-write" },
  modelFlag: "-m",
  resume: ["resume"],
  refusedValues: ["danger-full-access"],
  signIn: ["session", "login"],
  status: {
    args: ["session", "status"],
    signedIn: { stdout: "ready\n", exitCode: 0 },
    signedOut: { stdout: "sign in\n", exitCode: 1 },
  },
  models: ["example-model", "example-fast"],
  modelsCommand: ["models"],
  install: { command: "example-installer", args: ["example-agent"] },
};

// Hand-typed by the Chair (B-21.T4) from the local --help and --version output of
// Claude Code 2.1.318 and codex-cli 0.166.0; nothing here was recorded from a real account or run.
// Neither command line has a model-list command, so the catalog list is used (AD-08).
export const AGENT_PROFILES: Readonly<Record<"claude-code" | "codex", AgentProfile>> = {
  "claude-code": {
    program: "claude",
    run: ["-p", "--output-format", "stream-json", "--verbose"],
    // Claude Code has no sandbox flag; a step is limited by its tool list.
    sandboxFlag: "--tools",
    sandbox: { workspaceWrite: "Read,Glob,Grep,Edit,Write", readOnly: "Read,Glob,Grep", chat: "" },
    modelFlag: "--model",
    resume: ["--resume"],
    refusedValues: [
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
      "--yolo",
      "--trust-all-tools",
    ],
    signIn: ["auth", "login"],
    status: {
      args: ["auth", "status", "--json"],
      signedIn: { stdout: '{"loggedIn":true}\n', exitCode: 0 },
      signedOut: { stdout: '{"loggedIn":false}\n', exitCode: 1 },
    },
    models: ["opus", "sonnet", "haiku"],
    modelsCommand: [],
    install: { command: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] },
    memoryOff: {
      settings: { autoMemoryEnabled: false },
      gap: "The person's own CLAUDE.md files still load: Claude Code 2.1.318 has a claudeMdExcludes setting, but how it matches files could not be confirmed from local help.",
    },
  },
  codex: {
    program: "codex",
    run: ["exec", "--json"],
    sandboxFlag: "-s",
    sandbox: { workspaceWrite: "workspace-write", readOnly: "read-only", chat: "workspace-write" },
    modelFlag: "-m",
    resume: ["exec", "resume"],
    refusedValues: [
      "danger-full-access",
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
      "--approve-for-me",
      "--full-auto",
      "--yolo",
    ],
    signIn: ["login"],
    status: {
      args: ["login", "status"],
      signedIn: { stdout: "Logged in using ChatGPT\n", exitCode: 0 },
      signedOut: { stdout: "Not logged in\n", exitCode: 1 },
    },
    models: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"],
    modelsCommand: [],
    install: { command: "npm", args: ["install", "-g", "@openai/codex"] },
  },
};
