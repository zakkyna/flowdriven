import { z } from "zod";
import { Effect, Id, IsoDateTime, Place } from "./common.ts";

export const RiskyAction = z.enum(["send", "post", "pay", "delete", "merge"]);
export type RiskyAction = z.infer<typeof RiskyAction>;
export const RISKY_ACTIONS: readonly RiskyAction[] = ["send", "post", "pay", "delete", "merge"];
export const ApprovalKind = z.enum([
  "risky_action",
  "flow_sign_off",
  "result_sign_off",
  "budget_raise",
  "requirement_addition",
  "ask",
  "weekly_limit",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;
export const ApprovalState = z.enum([
  "pending",
  "approved",
  "approved_edited",
  "rejected",
  "expired",
  "allowed_always",
]);
export type ApprovalState = z.infer<typeof ApprovalState>;
export const Payload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("email"),
    to: z.array(z.string()).min(1),
    cc: z.array(z.string()).optional(),
    subject: z.string(),
    body: z.string(),
  }),
  z.object({ kind: z.literal("post"), platform: z.string(), text: z.string(), media: z.array(z.string()) }),
  z.object({
    kind: z.literal("diff"),
    files: z.array(z.object({ path: z.string(), patch: z.string() })).min(1),
  }),
  z.object({ kind: z.literal("amount"), amountUsd: z.number(), description: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("choice"),
    question: z.string(),
    options: z.array(z.object({ key: z.string(), label: z.string() })),
    maxPick: z.number().int().min(1),
    approves: z.array(z.string().min(1)).default([]),
  }),
]);
export type Payload = z.infer<typeof Payload>;
export const ResolvedVia = z.enum(["window", "chat", "phone", "rule", "expiry", "stop", "permission_off"]);
export type ResolvedVia = z.infer<typeof ResolvedVia>;
const ApprovalFields = z.strictObject({
  id: Id,
  kind: ApprovalKind,
  riskyAction: RiskyAction.optional(),
  effect: Effect.optional(),
  place: Place.optional(),
  fixedPlace: z.boolean().optional(),
  canAlwaysAllow: z.boolean(),
  stepWaiting: z.number().int().min(0),
  similarWaiting: z.number().int().min(0).optional(),
  resolvedVia: ResolvedVia.optional(),
  editedSubject: z.string().max(300).optional(),
  editedText: z.string().max(4000).optional(),
  chatId: Id.optional(),
  ruleId: Id.optional(),
  flowId: Id.optional(),
  flowName: z.string().optional(),
  runId: Id.optional(),
  stepId: Id.optional(),
  stepTitle: z.string().optional(),
  itemKey: z.string().optional(),
  summary: z.string().max(200),
  payload: Payload,
  editable: z.boolean(),
  similarGroup: z.string().optional(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  state: ApprovalState,
  resolvedAt: IsoDateTime.optional(),
  picks: z.array(z.string()).optional(),
  outside: z.boolean().optional(),
});
export const Approval = ApprovalFields.superRefine((approval, ctx) => {
  if (approval.kind === "weekly_limit" || approval.kind === "budget_raise") {
    if (approval.payload.kind !== "text")
      ctx.addIssue({ code: "custom", path: ["payload"], message: "A limit approval requires text." });
    for (const field of ["runId", "stepId", "itemKey"] as const)
      if (approval[field] !== undefined)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "A limit approval cannot name a run, step or item.",
        });
  } else {
    for (const field of ["flowId", "flowName"] as const)
      if (approval[field] === undefined)
        ctx.addIssue({ code: "custom", path: [field], message: "A flow is required." });
  }
  if ((approval.kind === "ask") !== (approval.payload.kind === "choice")) {
    ctx.addIssue({
      code: "custom",
      path: ["payload"],
      message: "A choice payload is required exactly for ask approvals.",
    });
  }
  const risky = RISKY_ACTIONS.some((effect) => effect === approval.effect);
  if (
    approval.kind === "risky_action" &&
    (!approval.effect ||
      (risky ? approval.riskyAction !== approval.effect : approval.riskyAction !== undefined))
  )
    ctx.addIssue({ code: "custom", path: ["effect"], message: "The effect and risky action must agree." });
  if (approval.kind !== "risky_action" && approval.riskyAction !== undefined)
    ctx.addIssue({
      code: "custom",
      path: ["riskyAction"],
      message: "Only risky actions name a risky action.",
    });
  if (
    approval.canAlwaysAllow &&
    (approval.kind !== "risky_action" ||
      approval.state !== "pending" ||
      approval.effect !== "change" ||
      !approval.fixedPlace)
  )
    ctx.addIssue({
      code: "custom",
      path: ["canAlwaysAllow"],
      message: "Always allow needs a pending change at a fixed place.",
    });
});
export type Approval = z.infer<typeof Approval>;
export const ApprovalDecision = z.enum(["approve", "edit", "reject", "always_allow"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
export const APPROVAL_EXPIRY_HOURS = 24;
export function approvalExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
}

export const ApprovalsListInput = z.strictObject({
  state: ApprovalState.optional(),
  runId: Id.optional(),
  flowId: Id.optional(),
});
export type ApprovalsListInput = z.infer<typeof ApprovalsListInput>;
export const ApprovalsListOutput = z.array(Approval);
export type ApprovalsListOutput = z.infer<typeof ApprovalsListOutput>;
export const ApprovalsResolveInput = z
  .strictObject({
    approvalId: Id,
    decision: ApprovalDecision,
    editedText: z.string().min(1).max(4000).optional(),
    editedSubject: z.string().min(1).max(300).optional(),
  })
  .refine((v) => (v.decision === "edit") === (v.editedText !== undefined));
export type ApprovalsResolveInput = z.infer<typeof ApprovalsResolveInput>;
export const ApprovalsResolveOutput = z.strictObject({
  decision: Approval,
  stepWaiting: z.number().int().min(0),
  ruleId: Id.optional(),
});
export type ApprovalsResolveOutput = z.infer<typeof ApprovalsResolveOutput>;
export const ApprovalsAnswerInput = z.strictObject({
  approvalId: Id,
  picks: z.array(z.string().min(1).max(100)).max(50),
});
export type ApprovalsAnswerInput = z.infer<typeof ApprovalsAnswerInput>;
export const ApprovalsAnswerOutput = z.strictObject({ decision: Approval });
export type ApprovalsAnswerOutput = z.infer<typeof ApprovalsAnswerOutput>;
export const ApprovalsResolveSimilarInput = z
  .strictObject({ runId: Id, group: z.string().min(1).max(100), approvalIds: z.array(Id).min(2).max(50) })
  .refine((v) => new Set(v.approvalIds).size === v.approvalIds.length);
export type ApprovalsResolveSimilarInput = z.infer<typeof ApprovalsResolveSimilarInput>;
export const ApprovalsResolveSimilarOutput = z.strictObject({ decisions: z.array(Approval) });
export type ApprovalsResolveSimilarOutput = z.infer<typeof ApprovalsResolveSimilarOutput>;
