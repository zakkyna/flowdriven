import { z } from "zod";
import { Id, IsoDateTime } from "./common.ts";

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
export const ApprovalState = z.enum(["pending", "approved", "rejected", "expired"]);
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
const ApprovalFields = z.object({
  id: Id,
  kind: ApprovalKind,
  riskyAction: RiskyAction.optional(),
  flowId: Id.optional(),
  flowName: z.string().optional(),
  runId: Id.optional(),
  stepId: Id.optional(),
  stepTitle: z.string().optional(),
  itemKey: z.string().optional(),
  summary: z.string(),
  payload: Payload,
  editable: z.boolean(),
  similarGroup: z.string().optional(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  state: ApprovalState,
  resolvedAt: IsoDateTime.optional(),
  picks: z.array(z.string()).optional(),
});
export const Approval = z
  .discriminatedUnion("kind", [
    ApprovalFields.extend({ kind: z.literal("weekly_limit") }),
    ApprovalFields.extend({ kind: ApprovalKind.exclude(["weekly_limit"]), flowId: Id, flowName: z.string() }),
  ])
  .superRefine((approval, ctx) => {
    if (approval.kind === "weekly_limit") {
      if (approval.payload.kind !== "text") {
        ctx.addIssue({
          code: "custom",
          path: ["payload"],
          message: "A weekly limit approval requires a text payload.",
        });
      }
      for (const field of ["runId", "stepId", "itemKey"] as const) {
        if (approval[field] !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "A weekly limit approval cannot name a run, step or item.",
          });
        }
      }
    } else {
      for (const field of ["flowId", "flowName"] as const) {
        if (approval[field] === undefined) {
          ctx.addIssue({ code: "custom", path: [field], message: "A flow is required for this approval." });
        }
      }
    }

    if ((approval.kind === "ask") !== (approval.payload.kind === "choice")) {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: "A choice payload is required exactly for ask approvals.",
      });
    }
    if ((approval.kind === "risky_action") !== (approval.riskyAction !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["riskyAction"],
        message: "A risky action is required exactly for risky action approvals.",
      });
    }
  });
export type Approval = z.infer<typeof Approval>;
export const ApprovalDecision = z.enum(["approve", "edit", "reject"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
export const APPROVAL_EXPIRY_HOURS = 24;
export function approvalExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
}
