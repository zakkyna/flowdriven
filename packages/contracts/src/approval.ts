import { z } from "zod";
import { containsHiddenText, Effect, Id, IsoDateTime, Line, Place } from "./common.ts";

export const RiskyAction = z.enum(["send", "post", "pay", "delete", "merge"]);
export type RiskyAction = z.infer<typeof RiskyAction>;
export const RISKY_ACTIONS: readonly RiskyAction[] = ["send", "post", "pay", "delete", "merge"];
export const ApprovalKind = z.enum([
  "risky_action",
  "outside_flow",
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
  "another_way",
]);
export type ApprovalState = z.infer<typeof ApprovalState>;
const payloadText = z.string().max(4000);
const payloadList = z.array(payloadText).max(50);
export const Payload = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("email"),
    to: payloadList.min(1),
    cc: payloadList.optional(),
    bcc: payloadList.optional(),
    attachments: payloadList.optional(),
    subject: payloadText,
    body: payloadText,
  }),
  z.strictObject({ kind: z.literal("post"), platform: payloadText, text: payloadText, media: payloadList }),
  z.strictObject({
    kind: z.literal("diff"),
    files: z
      .array(z.strictObject({ path: payloadText, patch: payloadText }))
      .min(1)
      .max(50),
  }),
  z.strictObject({ kind: z.literal("amount"), amountUsd: z.number(), description: payloadText }),
  z.strictObject({ kind: z.literal("text"), text: payloadText }),
  z.strictObject({
    kind: z.literal("choice"),
    question: payloadText,
    options: z.array(z.strictObject({ key: payloadText, label: payloadText })).max(50),
    maxPick: z.number().int().min(1),
    approves: z.array(z.string().min(1).max(4000)).max(50).default([]),
  }),
]);
export type Payload = z.infer<typeof Payload>;
export const ResolvedVia = z.enum(["window", "chat", "phone", "rule", "stop", "permission_off"]);
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
  anotherWayText: z
    .string()
    .min(1)
    .max(4000)
    .refine((text) => !containsHiddenText(text))
    .optional(),
  newTry: Line.optional(),
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
    (approval.kind === "risky_action" || approval.kind === "outside_flow") &&
    (!approval.effect ||
      (risky ? approval.riskyAction !== approval.effect : approval.riskyAction !== undefined))
  )
    ctx.addIssue({ code: "custom", path: ["effect"], message: "The effect and risky action must agree." });
  if (
    approval.kind !== "risky_action" &&
    approval.kind !== "outside_flow" &&
    approval.riskyAction !== undefined
  )
    ctx.addIssue({
      code: "custom",
      path: ["riskyAction"],
      message: "Only risky actions name a risky action.",
    });
  if (
    approval.kind === "outside_flow" &&
    (approval.editable ||
      approval.canAlwaysAllow ||
      approval.similarGroup !== undefined ||
      approval.similarWaiting !== undefined)
  )
    ctx.addIssue({ code: "custom", message: "Outside decisions cannot be edited or grouped." });
  const canTry = ["risky_action", "outside_flow", "result_sign_off"].includes(approval.kind);
  if (
    (approval.state === "another_way") !== (approval.anotherWayText !== undefined) ||
    (approval.state === "another_way" && !canTry)
  )
    ctx.addIssue({
      code: "custom",
      path: ["anotherWayText"],
      message: "Another way requires its text and an eligible decision.",
    });
  if (
    approval.newTry &&
    (!canTry ||
      approval.newTry.key !== "decision.newTry" ||
      typeof approval.newTry.params?.text !== "string" ||
      !approval.newTry.params.text ||
      containsHiddenText(approval.newTry.params.text))
  )
    ctx.addIssue({ code: "custom", path: ["newTry"], message: "New try requires its text." });
  if (
    approval.canAlwaysAllow &&
    (approval.kind !== "risky_action" ||
      approval.state !== "pending" ||
      approval.effect !== "change" ||
      !approval.fixedPlace ||
      !approval.place ||
      !["account", "folder"].includes(approval.place.kind) ||
      approval.outside === true)
  )
    ctx.addIssue({
      code: "custom",
      path: ["canAlwaysAllow"],
      message: "Always allow needs a pending change at a fixed place.",
    });
  if (
    approval.state === "allowed_always" &&
    (approval.kind !== "risky_action" || approval.effect !== "change" || !approval.ruleId)
  )
    ctx.addIssue({ code: "custom", path: ["state"], message: "Always allowed needs a change and a rule." });
});
export type Approval = z.infer<typeof Approval>;
export const ApprovalDecision = z.enum(["approve", "edit", "reject", "always_allow", "another_way"]);
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
    anotherWayText: z
      .string()
      .min(1)
      .max(4000)
      .refine((text) => !containsHiddenText(text))
      .optional(),
  })
  .refine(
    (v) =>
      (v.decision === "edit") === (v.editedText !== undefined) &&
      (v.editedSubject === undefined || v.decision === "edit") &&
      (v.decision === "another_way") === (v.anotherWayText !== undefined),
  );
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
