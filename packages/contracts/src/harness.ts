import { z } from "zod";
import { Id, IsoDateTime, RiskLabel } from "./common";

export const LoginState = z.enum(["logged_in", "logged_out", "unknown"]);
export type LoginState = z.infer<typeof LoginState>;
export const QuotaState = z.enum(["available", "exhausted", "unknown"]);
export type QuotaState = z.infer<typeof QuotaState>;
export const ConsentState = z.enum(["not_needed", "not_given", "given", "revoked"]);
export type ConsentState = z.infer<typeof ConsentState>;
export const ConnectionState = z.enum(["connected", "needs_login", "failed"]);
export type ConnectionState = z.infer<typeof ConnectionState>;
export const InventoryItem = z.object({
  name: z.string(),
  scope: z.enum(["user", "project"]),
  source: z.string().optional(),
  connection: ConnectionState.optional(),
});
export type InventoryItem = z.infer<typeof InventoryItem>;
export const Usage = z.object({ calls: z.number().int().min(0), tokens: z.number().int().min(0).optional() });
export type Usage = z.infer<typeof Usage>;
export const HarnessCard = z.object({
  id: Id,
  name: z.string(),
  binary: z.string(),
  detected: z.boolean(),
  version: z.string().optional(),
  path: z.string().optional(),
  login: LoginState,
  risk: RiskLabel,
  riskNote: z.string().optional(),
  vendorProhibited: z.boolean(),
  consent: ConsentState,
  consentText: z.string().optional(),
  sandbox: z.enum(["os", "none"]),
  adapter: z.enum(["full", "detection_only"]),
  quota: z.object({
    state: QuotaState,
    until: IsoDateTime.optional(),
    today: Usage,
    week: Usage,
    note: z.string().optional(),
  }),
  inventory: z.object({
    supported: z.boolean(),
    skills: z.array(InventoryItem),
    plugins: z.array(InventoryItem),
    mcpServers: z.array(InventoryItem),
  }),
});
export type HarnessCard = z.infer<typeof HarnessCard>;
