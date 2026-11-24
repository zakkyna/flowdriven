import { z } from "zod";
import { Approval } from "./approval.ts";
import { AgentId, ContentHash, Id, InputType, IsoDateTime, Line, ModelId, TouchId } from "./common.ts";
import { FlowState, InputView, ScheduleSpec, ScheduleView, TouchView } from "./flow.ts";
import { InputProblem, RunState, RunSummary } from "./run.ts";

const display = z.string().min(1).max(200);
const text = z.string().max(4000);
const labelValue = z.strictObject({ label: display, text });
const choices = z.array(z.strictObject({ key: display, label: display })).max(50);
const named = { flowId: Id, name: display };
const runRef = z.strictObject({ runId: Id, flowName: display });
const actionNames = [
  "start",
  "change_plan",
  "run",
  "not_now",
  "confirm_flow",
  "use_form",
  "use_last_answers",
  "cancel_question",
  "submit_form",
  "save_flow",
  "change_draft",
  "save_change",
  "cancel_change",
  "set_schedule",
  "skip_schedule",
  "turn_off_schedule",
  "keep_schedule",
  "stop_runs",
  "keep_running",
  "every_time",
  "only_this_time",
  "run_now",
  "propose_schedule",
  "choose",
  "retry_turn",
  "suggestion",
] as const;
export const CardAction = z.enum(actionNames);
export type CardAction = z.infer<typeof CardAction>;
const bare = [
  "start",
  "change_plan",
  "run",
  "not_now",
  "use_form",
  "use_last_answers",
  "cancel_question",
  "save_flow",
  "save_change",
  "cancel_change",
  "set_schedule",
  "skip_schedule",
  "turn_off_schedule",
  "keep_schedule",
  "stop_runs",
  "keep_running",
  "every_time",
  "only_this_time",
  "run_now",
  "propose_schedule",
  "retry_turn",
] as const;
const confirmValues = z
  .strictObject({
    hash: ContentHash,
    onItsOwn: z.array(TouchId).max(100),
    pins: z.record(z.string().min(1).max(100), z.string().min(1).max(600)).optional(),
  })
  .refine((v) => new Set(v.onItsOwn).size === v.onItsOwn.length && Object.keys(v.pins ?? {}).length <= 50);
export const ChatAct = z.union([
  z.strictObject({ action: z.enum(bare) }),
  z.strictObject({ action: z.literal("confirm_flow"), values: confirmValues }),
  z.strictObject({
    action: z.literal("submit_form"),
    values: z.strictObject({ fields: z.record(z.string(), text).refine((v) => Object.keys(v).length <= 50) }),
  }),
  z.strictObject({
    action: z.literal("change_draft"),
    values: z
      .strictObject({
        text: z
          .string()
          .min(1)
          .max(16000)
          .refine((v) => v.trim().length > 0),
      })
      .optional(),
  }),
  z.strictObject({ action: z.literal("choose"), values: z.strictObject({ option: display }) }),
  z.strictObject({
    action: z.literal("suggestion"),
    values: z.strictObject({ chip: z.number().int().min(0) }),
  }),
]);
export type ChatAct = z.infer<typeof ChatAct>;
export const DraftView = z.strictObject({
  id: Id,
  kind: z.enum(["new_flow", "change"]),
  state: z.enum(["drafted", "replaced", "saved", "cancelled", "stale"]),
  name: display,
  nameAdjusted: z.boolean(),
  flowId: Id.optional(),
  madeFromSkill: z.strictObject({ skillId: Id, name: display }).optional(),
  steps: z.array(z.strictObject({ title: display, asksFirst: z.boolean() })).max(50),
  inputs: z.array(InputView).max(50),
  result: z.enum(["chat", "report"]),
  schedule: ScheduleView,
  lists: z.strictObject({
    onItsOwn: z.array(TouchView).max(50),
    asksFirst: z.array(TouchView).max(50),
    never: z.array(TouchView).max(50),
  }),
  outside: z.boolean(),
  assumptions: z.array(display).max(50),
  changes: z
    .array(z.strictObject({ sign: z.enum(["+", "-", "~"]), text: display }))
    .max(50)
    .optional(),
});
export type DraftView = z.infer<typeof DraftView>;
const base = {
  state: z.enum(["open", "answered", "replaced", "cancelled", "stale", "flow_deleted"]),
  answer: z.strictObject({ action: CardAction, at: IsoDateTime }).optional(),
};
export const CardView = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("plan"),
    mode: z.enum(["chain", "together"]),
    items: z
      .array(z.strictObject({ ...named, flowState: FlowState, values: z.array(labelValue).max(50) }))
      .min(1)
      .max(200),
    agent: AgentId,
    model: ModelId,
  }),
  z.strictObject({ ...base, type: z.literal("ask_run"), ...named, values: z.array(labelValue).max(50) }),
  z.strictObject({
    ...base,
    type: z.literal("confirm"),
    ...named,
    hash: ContentHash,
    // biome-ignore lint/suspicious/noThenProperty: The contract names this field then.
    then: z.enum(["start", "offer"]),
  }),
  z.strictObject({
    ...base,
    type: z.literal("inputs_ask"),
    ...named,
    questionId: Id,
    lead: Line.optional(),
    missing: z
      .array(z.strictObject({ inputId: Id, label: display, problem: InputProblem.optional() }))
      .max(50),
    known: z.array(labelValue).max(50),
    canUseLast: z.boolean(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("form"),
    ...named,
    questionId: Id,
    fields: z
      .array(
        z.strictObject({
          inputId: Id,
          label: display,
          type: InputType,
          required: z.boolean(),
          value: text.optional(),
          choices: choices.optional(),
          example: display.optional(),
        }),
      )
      .max(50),
  }),
  z.strictObject({
    ...base,
    type: z.literal("runs"),
    mode: z.enum(["single", "chain", "together"]),
    runs: z.array(RunSummary).max(50),
    notStarted: z.array(display).max(50),
  }),
  z.strictObject({ ...base, type: z.literal("decision"), decision: Approval }),
  z.strictObject({ ...base, type: z.literal("draft"), draft: DraftView }),
  z.strictObject({ ...base, type: z.literal("change"), draft: DraftView }),
  z.strictObject({
    ...base,
    type: z.literal("schedule"),
    ...named,
    schedule: ScheduleView,
    replaces: ScheduleView.optional(),
  }),
  z.strictObject({ ...base, type: z.literal("unschedule"), ...named, schedule: ScheduleView }),
  z.strictObject({ ...base, type: z.literal("stop"), runs: z.array(runRef).max(50) }),
  z.strictObject({
    ...base,
    type: z.literal("status"),
    needsYou: z
      .array(
        z.strictObject({
          kind: z.enum(["decision", "question"]),
          title: display,
          runId: Id.optional(),
          chatId: Id.optional(),
        }),
      )
      .max(50),
    running: z.array(runRef).max(50),
    latest: z.strictObject({ flowName: display, state: RunState, at: IsoDateTime }).optional(),
    problems: z.array(runRef).max(50),
  }),
  z.strictObject({
    ...base,
    type: z.literal("repeat_offer"),
    ...named,
    afterFlowId: Id,
    afterName: display,
    replaces: ScheduleView.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("run_offer"),
    ...named,
    schedule: ScheduleView,
    suggested: ScheduleSpec.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("choose"),
    purpose: z.enum(["flow", "skill"]),
    options: z.array(z.strictObject({ value: display, label: display })).max(50),
  }),
  z.strictObject({
    ...base,
    type: z.literal("agent_needed"),
    need: z.enum(["permission", "set_up", "sign_in"]),
    agentId: AgentId.optional(),
    agentName: display.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("turn_failed"),
    forMessageId: Id,
    failure: z.enum([
      "not_understood",
      "no_usage",
      "spending_limit",
      "agent_failed",
      "timeout",
      "interrupted",
    ]),
    agentName: display.optional(),
    until: IsoDateTime.optional(),
  }),
]);
export type CardView = z.infer<typeof CardView>;
