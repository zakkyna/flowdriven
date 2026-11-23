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
  "--no-chrome",
];
export const REFUSED_FLAGS = [
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--permission-mode",
  "--yolo",
  "--trust-all-tools",
] as const;
export type ClaudeModel = string;
export type MemoryOff = { settings: Record<string, boolean>; gap?: "own_instruction_files" };
export const CLAUDE_MEMORY_OFF: MemoryOff = {
  settings: { autoMemoryEnabled: false },
  gap: "own_instruction_files",
};
export function workerSettings<T extends object>(settings: T, memoryOff: MemoryOff | undefined): T {
  return { ...memoryOff?.settings, ...settings };
}
export function claudeMemoryGap(
  memoryOff: MemoryOff | undefined,
): "memory_on" | "own_instruction_files" | undefined {
  return memoryOff ? memoryOff.gap : "memory_on";
}
export type ArgsInput = {
  model: ClaudeModel;
  sessionId: string;
  tools: string[];
  settingsPath: string;
  addDirs: string[];
  schema?: object;
  chrome?: boolean;
  mcpConfigPath?: string;
};
export function assertSafeArgs(args: readonly string[]): void {
  for (const arg of args)
    for (const flag of REFUSED_FLAGS)
      if (arg === flag || arg.startsWith(`${flag}=`)) throw new Error(`Refused flag: ${flag}`);
}
export function buildClaudeArgs(input: ArgsInput): string[] {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(input.model)) throw new Error("Refused model name.");
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
    input.mcpConfigPath ?? '{"mcpServers":{}}',
    "--tools",
    input.tools.join(","),
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    "--settings",
    input.settingsPath,
    input.chrome ? "--chrome" : "--no-chrome",
  ];
  for (const dir of input.addDirs) args.push("--add-dir", dir);
  if (input.schema !== undefined) args.push("--json-schema", JSON.stringify(input.schema));
  assertSafeArgs(args);
  return args;
}
export function buildClaudeChatArgs(input: {
  model: ClaudeModel;
  schema: object;
  sessionId?: string;
  settingsPath?: string;
  mcpConfigPath?: string;
}): string[] {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(input.model)) throw new Error("Refused model name.");
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--model",
    input.model,
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    input.mcpConfigPath ?? '{"mcpServers":{}}',
    "--tools",
    "",
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    "--no-chrome",
    "--json-schema",
    JSON.stringify(input.schema),
  ];
  if (input.sessionId !== undefined) args.push("--session-id", input.sessionId);
  if (input.settingsPath !== undefined) args.push("--settings", input.settingsPath);
  assertSafeArgs(args);
  return args;
}
export function buildConnectorScanArgs(): string[] {
  const args = [
    "-p",
    "--model",
    "haiku",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--tools",
    "",
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    "--settings",
    '{"disableAllHooks":true}',
  ];
  assertSafeArgs(args);
  return args;
}
