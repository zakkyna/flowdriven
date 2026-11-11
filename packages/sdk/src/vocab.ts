export const FORMAT_ID = "flowdriven-flow/1.1";
export const RISKY_ACTIONS = ["send", "post", "pay", "delete", "merge"] as const;
export type RiskyAction = (typeof RISKY_ACTIONS)[number];
export const CHECK_TYPES = [
  "command",
  "files",
  "schema",
  "contains",
  "not_contains",
  "judge",
  "user",
  "probe",
] as const;
export type CheckType = (typeof CHECK_TYPES)[number];
export const BASE_REQUIREMENT_TYPES = [
  "harness",
  "skill",
  "plugin",
  "mcp_server",
  "cli_tool",
  "gui_app",
  "account",
  "browser_session",
  "path",
] as const;
export type BaseRequirementType = (typeof BASE_REQUIREMENT_TYPES)[number];
export const REQUIREMENT_TYPES = [...BASE_REQUIREMENT_TYPES, "web", "desktop", "trigger"] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];
