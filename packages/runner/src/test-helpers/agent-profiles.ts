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
