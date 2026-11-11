export const REQUIRED_FLAGS: readonly string[] = [
  "--output-format",
  "--verbose",
  "--no-session-persistence",
  "--session-id",
  "--model",
  "--restricted",
  "--strict-mcp-config",
  "--mcp-config",
  "--tools",
  "--disable-slash-commands",
  "--permission-prompts",
  "--settings",
  "--add-dir",
  "--json-schema",
];
export const REFUSED_FLAGS = [
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--permission-mode",
  "--yolo",
  "--trust-all-tools",
] as const;
export type ClaudeModel = "haiku" | "sonnet" | "opus";
export type ArgsInput = {
  model: ClaudeModel;
  sessionId: string;
  tools: string[];
  settingsPath: string;
  addDirs: string[];
  schema?: object;
};
export function assertSafeArgs(args: readonly string[]): void {
  for (const arg of args)
    for (const flag of REFUSED_FLAGS)
      if (arg === flag || arg.startsWith(`${flag}=`)) throw new Error(`Refused flag: ${flag}`);
}
export function buildClaudeArgs(input: ArgsInput): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--session-id",
    input.sessionId,
    "--model",
    input.model,
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--tools",
    input.tools.join(","),
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    "--settings",
    input.settingsPath,
  ];
  for (const dir of input.addDirs) args.push("--add-dir", dir);
  if (input.schema !== undefined) args.push("--json-schema", JSON.stringify(input.schema));
  assertSafeArgs(args);
  return args;
}
