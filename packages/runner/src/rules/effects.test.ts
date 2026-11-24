import { expect, test } from "vitest";
import { EFFECTS, effectOf } from "./effects.ts";

test("the catalog classifies Gmail tools and unknown tools conservatively", () => {
  for (const name of [
    "search_threads",
    "get_thread",
    "get_message",
    "list_labels",
    "list_drafts",
    "get_draft",
  ])
    expect(effectOf(`mcp__claude_ai_Gmail__${name}`).effect).toBe("read");
  for (const name of ["create_draft", "label_thread", "label_message", "update_message_labels"])
    expect(effectOf(`mcp__claude_ai_Gmail__${name}`)).toMatchObject({
      effect: "change",
      place: { kind: "account", value: "gmail" },
    });
  for (const name of ["send_message", "reply", "forward"])
    expect(effectOf(`mcp__claude_ai_Gmail__${name}`)).toMatchObject({
      effect: "send",
      place: { kind: "address", fromInput: ["to", "cc", "bcc"] },
    });
  for (const name of [
    "trash_thread",
    "trash_message",
    "delete_draft",
    "delete_label",
    "mark_thread_spam",
    "mark_message_spam",
  ])
    expect(effectOf(`mcp__claude_ai_Gmail__${name}`).effect).toBe("delete");
  expect(effectOf("unknown")).toEqual({ tool: "unknown", effect: "change", place: undefined });
  expect(new Set(EFFECTS.map((entry) => entry.tool)).size).toBe(EFFECTS.length);
});
