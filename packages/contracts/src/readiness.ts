import { z } from "zod";
import { Id, IsoDateTime, RouteOption } from "./common";
import { RequirementType } from "./flow";

export const RequirementState = z.enum(["ok", "missing", "needs_login", "failed"]);
export type RequirementState = z.infer<typeof RequirementState>;
export const ENFORCEMENT = ["enforced by FlowDriven", "enforced by the harness's settings"] as const;
export const Enforcement = z.enum(ENFORCEMENT);
export type Enforcement = z.infer<typeof Enforcement>;
export const FixGuide = z.object({
  steps: z.array(z.string()).min(1),
  commands: z.array(z.string()),
  verified: z.boolean(),
});
export type FixGuide = z.infer<typeof FixGuide>;
export const ReadinessItem = z
  .object({
    requirementId: Id,
    name: z.string(),
    type: RequirementType,
    why: z.string(),
    required: z.boolean(),
    sensitive: z.boolean(),
    state: RequirementState,
    detail: z.string().optional(),
    route: RouteOption,
    enforcement: Enforcement.optional(),
    autoInstall: z.enum(["yes", "guided"]),
    installCommand: z.string().optional(),
    guide: FixGuide,
    checkedAt: IsoDateTime,
  })
  .refine((item) => (item.autoInstall === "yes") === (item.installCommand !== undefined), {
    path: ["installCommand"],
    message: "An install command is required exactly for automatic installation.",
  });
export type ReadinessItem = z.infer<typeof ReadinessItem>;
export const ReadinessReport = z.object({
  flowId: Id,
  flowName: z.string(),
  checkedAt: IsoDateTime,
  ready: z.boolean(),
  items: z.array(ReadinessItem),
});
export type ReadinessReport = z.infer<typeof ReadinessReport>;
export function isReady(items: ReadinessItem[]): boolean {
  return items.every((item) => !item.required || item.state === "ok");
}
export function attentionCount(items: ReadinessItem[]): number {
  return items.filter((item) => item.required && item.state !== "ok").length;
}
