import type { Touch } from "@flowdriven/sdk";

export type Effect = Touch["effect"];
export const EFFECT_RANK: Record<Effect, number> = {
  read: 0,
  local_write: 1,
  run_command: 1,
  change: 2,
  send: 3,
  post: 3,
  pay: 3,
  delete: 3,
  merge: 3,
};
export type EffectEntry = {
  tool: string;
  effect: Effect;
  place: { kind: "account"; value: string } | { kind: "address"; fromInput: string[] } | undefined;
};
const prefix = "mcp__claude_ai_Gmail__";
const account = { kind: "account", value: "gmail" } as const;
const address: NonNullable<EffectEntry["place"]> = { kind: "address", fromInput: ["to", "cc", "bcc"] };
export const EFFECTS: EffectEntry[] = [
  ...["search_threads", "get_thread", "get_message", "list_labels", "list_drafts", "get_draft"].map(
    (tool) => ({ tool: prefix + tool, effect: "read" as const, place: account }),
  ),
  ...["create_draft", "label_thread", "label_message", "update_message_labels"].map((tool) => ({
    tool: prefix + tool,
    effect: "change" as const,
    place: account,
  })),
  ...["send_message", "reply", "forward"].map((tool) => ({
    tool: prefix + tool,
    effect: "send" as const,
    place: address,
  })),
  ...[
    "trash_thread",
    "trash_message",
    "delete_draft",
    "delete_label",
    "mark_thread_spam",
    "mark_message_spam",
  ].map((tool) => ({ tool: prefix + tool, effect: "delete" as const, place: undefined })),
];
export function effectOf(tool: string, catalog: EffectEntry[] = EFFECTS): EffectEntry {
  return catalog.find((entry) => entry.tool === tool) ?? { tool, effect: "change", place: undefined };
}
