import { STATUS_KEYS } from "./status";

export const dynamicKeys = [
  ...STATUS_KEYS,
  "status.not_started",
  "status.waiting",
  "status.unchecked",
  "status.ready",
  "status.not_installed",
  "status.installing",
  "agents.needsSignIn",
  "agentState.ready",
  "agentState.not_installed",
  "agentState.needs_login",
  "agentState.installing",
  "agentState.waiting_login",
  "agentState.unknown",
] as const;
