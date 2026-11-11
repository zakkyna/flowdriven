import { z } from "zod";
import { Id, RiskLabel } from "./common.ts";
import { ConsentState, LoginState, QuotaState } from "./harness.ts";

export const BrainBackend = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(["harness", "api_key"]),
  risk: RiskLabel,
  available: z.boolean(),
  login: LoginState,
  quota: QuotaState,
  consent: ConsentState,
  keyStored: z.boolean().optional(),
});
export type BrainBackend = z.infer<typeof BrainBackend>;
export const Budget = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  capUsd: z.number().min(0).default(0),
  perRunCapUsd: z.number().min(0).nullable(),
  spentUsd: z.number().min(0),
});
export type Budget = z.infer<typeof Budget>;
export const Settings = z.object({
  brain: z.object({ main: Id.nullable(), subscriptionOrder: z.array(Id), apiKeyOrder: z.array(Id) }),
  backends: z.array(BrainBackend),
  budget: Budget,
  offerSaveOneTime: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;
export const SettingsPatch = z.object({
  brain: z
    .object({
      main: Id.optional(),
      subscriptionOrder: z.array(Id).optional(),
      apiKeyOrder: z.array(Id).optional(),
    })
    .optional(),
  budget: z
    .object({ capUsd: z.number().min(0).optional(), perRunCapUsd: z.number().min(0).nullable().optional() })
    .optional(),
  offerSaveOneTime: z.boolean().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;
export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_STOP_RATIO = 1;
export const COST_PREVIEW_RATIO = 0.1;
export function budgetStatus(budget: Budget): { level: "off" | "ok" | "warn" | "stopped"; ratio: number } {
  if (budget.capUsd === 0) return { level: "off", ratio: 0 };
  const ratio = budget.spentUsd / budget.capUsd;
  return {
    level: ratio >= BUDGET_STOP_RATIO ? "stopped" : ratio >= BUDGET_WARN_RATIO ? "warn" : "ok",
    ratio,
  };
}
export function sortByRisk<T extends { risk: RiskLabel }>(items: T[]): T[] {
  const rank = { official: 0, gray: 1, unofficial: 2 };
  return [...items].sort((a, b) => rank[a.risk] - rank[b.risk]);
}
