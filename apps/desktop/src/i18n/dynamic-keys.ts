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
] as const;
