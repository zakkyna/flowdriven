import { z } from "zod";
import { ContentHash, Id } from "./common.ts";
import { RequirementType } from "./flow.ts";

export const ENFORCERS = [
  "FlowDriven",
  "FlowDriven hook in Claude Code",
  "Claude Code's settings",
  "not enforced",
] as const;
export const Enforcer = z.enum(ENFORCERS);
export type Enforcer = z.infer<typeof Enforcer>;
export const CONSENT_STATES = ["none", "given", "stale"] as const;
export const CapabilityConsent = z.enum(CONSENT_STATES);
export type CapabilityConsent = z.infer<typeof CapabilityConsent>;
export const CapabilityRow = z
  .strictObject({
    requirementId: Id,
    type: RequirementType,
    sentence: z.string().min(1).max(2400),
    routed: z.boolean(),
    provider: z.string().max(80).optional(),
    enforcedBy: Enforcer.optional(),
    label: z.enum(["official", "gray", "unofficial"]).optional(),
    labelSentence: z.string().max(200).optional(),
    away: z.boolean(),
    reason: z.string().max(200).optional(),
    cost: z.string().max(120).optional(),
    pin: z.string().min(1).max(600).optional(),
    details: z.array(z.string().max(300)).max(8),
  })
  .refine((row) =>
    row.routed
      ? row.provider !== undefined && row.enforcedBy !== undefined && row.label !== undefined
      : row.reason !== undefined,
  );
export type CapabilityRow = z.infer<typeof CapabilityRow>;
export const FlowCapabilities = z.strictObject({
  flowId: Id,
  hash: ContentHash,
  rows: z.array(CapabilityRow).max(50),
  caps: z.strictObject({
    maxRunsPerDay: z.number().int().min(1),
    maxItems: z.number().int().min(1).optional(),
  }),
  hasTriggers: z.boolean(),
  needsAllow: z.boolean(),
  consent: CapabilityConsent,
  allowBlocked: z.string().min(1).max(200).optional(),
});
export type FlowCapabilities = z.infer<typeof FlowCapabilities>;
