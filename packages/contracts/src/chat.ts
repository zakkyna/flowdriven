import { z } from "zod";
import { CardAction, CardView, ChatAct } from "./card.ts";
import { AgentId, Id, IsoDateTime, LanguageCode, Line, ModelId, TypedValue } from "./common.ts";
import { Cause, FieldProblem, RunState, StepRunState } from "./run.ts";
import { StartOutcome } from "./starts.ts";

export { DraftView } from "./card.ts";

export const CHAT_INTENTS = [
  "answer",
  "run",
  "run_together",
  "run_chain",
  "stop",
  "status",
  "schedule",
  "unschedule",
  "make_flow",
  "make_flow_from_skill",
  "improve_flow",
  "fill_inputs",
] as const;
const display = z.string().min(1).max(200);
const index = z.number().int().min(0);
const answer = z.strictObject({
  lines: z.array(z.string().max(4000)).max(10),
  values: z.record(z.string(), TypedValue),
});
export const ChipView = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("suggestion"),
    index,
    label: z.union([Line, z.strictObject({ text: display })]),
  }),
  z.strictObject({ kind: z.literal("act"), label: Line, action: CardAction }),
  z.strictObject({ kind: z.literal("open"), label: Line, chatId: Id }),
]);
export type ChipView = z.infer<typeof ChipView>;
export const MessageView = z.strictObject({
  id: Id,
  seq: index,
  at: IsoDateTime,
  role: z.enum(["person", "agent", "flowdriven"]),
  kind: z.enum(["text", "reply", "line", "note", "result", "card"]),
  text: z.string().max(16000).optional(),
  line: Line.optional(),
  result: answer.extend({ runId: Id }).optional(),
  card: CardView.optional(),
  chips: z.array(ChipView).max(50).optional(),
  language: LanguageCode.optional(),
  outside: z.boolean(),
});
export type MessageView = z.infer<typeof MessageView>;
export const ChatSummary = z.strictObject({
  id: Id,
  title: z.string().max(200),
  updatedAt: IsoDateTime,
  from: z.enum(["person", "flowdriven"]),
  agent: AgentId,
  model: ModelId,
  language: LanguageCode,
  waiting: z.boolean(),
});
export type ChatSummary = z.infer<typeof ChatSummary>;
const subject = z.strictObject({
  kind: z.enum(["make", "improve", "skill", "flow", "change_draft"]),
  flowId: Id.optional(),
});
export const ChatView = z.strictObject({
  chat: ChatSummary.extend({ subject: subject.optional() }),
  messages: z.array(MessageView).max(500),
  more: z.boolean(),
  turn: z.strictObject({ state: z.enum(["idle", "queued", "thinking"]), queued: index }),
  composerText: z.string().max(16000),
  starters: z
    .array(
      z.strictObject({
        index,
        label: Line,
        code: z.enum(["run", "run_chain", "make_flow", "status"]),
        flowIds: z.array(Id).max(200).optional(),
      }),
    )
    .max(50)
    .optional(),
});
export type ChatView = z.infer<typeof ChatView>;
export const ChatsListInput = z.strictObject({});
export type ChatsListInput = z.infer<typeof ChatsListInput>;
export const ChatsListOutput = z.array(ChatSummary);
export type ChatsListOutput = z.infer<typeof ChatsListOutput>;
export const ChatsGetInput = z.strictObject({
  chatId: Id,
  before: index.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type ChatsGetInput = z.infer<typeof ChatsGetInput>;
export const ChatsGetOutput = ChatView;
export type ChatsGetOutput = z.infer<typeof ChatsGetOutput>;
export const ChatsCreateInput = z.strictObject({
  subject: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("make") }),
      z.strictObject({ kind: z.literal("improve"), flowId: Id }),
    ])
    .optional(),
});
export type ChatsCreateInput = z.infer<typeof ChatsCreateInput>;
export const ChatsCreateOutput = z.strictObject({ chatId: Id, reused: z.boolean() });
export type ChatsCreateOutput = z.infer<typeof ChatsCreateOutput>;
export const ChatsSendInput = z.union([
  z.strictObject({
    chatId: Id,
    text: z
      .string()
      .min(1)
      .max(16000)
      .refine((v) => v.trim().length > 0),
    pasted: z.boolean().optional(),
  }),
  z.strictObject({ chatId: Id, starter: index }),
]);
export type ChatsSendInput = z.infer<typeof ChatsSendInput>;
export const ChatsSendOutput = z.strictObject({
  messageId: Id,
  turn: z.enum(["queued", "not_ready", "form_open"]),
});
export type ChatsSendOutput = z.infer<typeof ChatsSendOutput>;
export const ChatsActInput = z.intersection(
  z.object({ chatId: Id, messageId: Id }),
  z.union(ChatAct.options.map((option) => option.safeExtend({ chatId: Id, messageId: Id }))),
);
export type ChatsActInput = z.infer<typeof ChatsActInput>;
export const ChatsActOutput = z.strictObject({
  card: CardView,
  posted: z.array(Id).max(50),
  starts: z.array(StartOutcome).max(50).optional(),
  fields: z.array(FieldProblem).max(50).optional(),
});
export type ChatsActOutput = z.infer<typeof ChatsActOutput>;
export const ChatsSetAgentInput = z.strictObject({ chatId: Id, agent: AgentId, model: ModelId });
export type ChatsSetAgentInput = z.infer<typeof ChatsSetAgentInput>;
export const ChatsSetAgentOutput = ChatSummary;
export type ChatsSetAgentOutput = z.infer<typeof ChatsSetAgentOutput>;
export const ChatsSetComposerInput = z.strictObject({ chatId: Id, text: z.string().max(16000) });
export type ChatsSetComposerInput = z.infer<typeof ChatsSetComposerInput>;
export const ChatsSetComposerOutput = z.strictObject({});
export type ChatsSetComposerOutput = z.infer<typeof ChatsSetComposerOutput>;
export const ChatsDeleteInput = z.strictObject({ chatId: Id });
export type ChatsDeleteInput = z.infer<typeof ChatsDeleteInput>;
export const ChatsDeleteOutput = z.strictObject({ deleted: z.literal(true) });
export type ChatsDeleteOutput = z.infer<typeof ChatsDeleteOutput>;
export const RunsExportOutput = z.strictObject({
  language: LanguageCode,
  flowName: display,
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.optional(),
  state: RunState,
  cause: Cause.optional(),
  summary: z.array(z.strictObject({ text: z.string().max(4000), outside: z.boolean() })).max(20),
  steps: z.array(z.strictObject({ title: display, state: StepRunState, outside: z.boolean() })).max(50),
  decisionLines: z.array(Line).max(50),
  answer: answer.optional(),
});
export type RunsExportOutput = z.infer<typeof RunsExportOutput>;
