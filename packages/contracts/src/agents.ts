import { z } from "zod";
import { AgentId, AgentState, IsoDateTime, Line, ModelId, RiskLabel } from "./common.ts";

export const Model = z.strictObject({
  id: ModelId,
  name: z.string(),
  note: z.enum(["mostCapable", "fastCapable", "fastest", "allRound", "carefulCoding"]),
  isDefault: z.boolean(),
});
export type Model = z.infer<typeof Model>;
export const AgentModels = z
  .array(Model)
  .min(1)
  .refine((models) => models.filter((model) => model.isDefault).length === 1);
export type AgentModels = z.infer<typeof AgentModels>;
export const AgentIdInput = z.strictObject({ agentId: AgentId });
export type AgentIdInput = z.infer<typeof AgentIdInput>;
export const Agent = z.strictObject({
  id: AgentId,
  name: z.string(),
  maker: z.string(),
  state: AgentState,
  version: z.string().optional(),
  accountLine: Line,
  risk: RiskLabel,
  riskNote: Line,
  canSetUp: z.boolean(),
  installCommand: z.string().optional(),
  billing: z.enum(["per_use", "plan", "unknown"]),
  models: AgentModels.optional(),
  defaultModel: ModelId.optional(),
  usage: z
    .strictObject({
      status: z.enum(["ok", "warning", "limited", "unknown"]),
      fiveHour: z.number().optional(),
      sevenDay: z.number().optional(),
      resetsAt: IsoDateTime.optional(),
    })
    .optional(),
  capability: z.strictObject({
    tier: z.enum(["enforced", "folder_limited", "label_only"]),
    accountTools: z.boolean(),
  }),
  setUp: z.strictObject({ phase: z.enum(["installing", "waiting_login"]), since: IsoDateTime }).optional(),
  problem: z
    .strictObject({
      code: z.enum(["install_failed", "sign_in_timeout", "too_old", "unreadable"]),
      detail: z.string().optional(),
    })
    .optional(),
});
export type Agent = z.infer<typeof Agent>;
