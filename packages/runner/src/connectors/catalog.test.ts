import { classifyTool } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { CONNECTORS, catalogEntry } from "./catalog.ts";

test("the catalog has one entry, connector:gmail, with the name, url, prefix and label measured in the probes", () => {
  expect(CONNECTORS).toHaveLength(1);
  expect(CONNECTORS.at(0)).toMatchObject({
    ref: "connector:gmail",
    name: "claude.ai Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    prefix: "mcp__claude_ai_Gmail__",
    label: "Gmail",
  });
});
test("the read list is the six read-only tools of G5, the risky map is the seven send and delete tools, and no tool is in both", () => {
  const entry = CONNECTORS.at(0);
  expect(entry?.read).toEqual([
    "search_threads",
    "get_thread",
    "get_message",
    "list_labels",
    "list_drafts",
    "get_draft",
  ]);
  expect(entry?.risky).toEqual({
    send_message: "send",
    reply: "send",
    forward: "send",
    trash_thread: "delete",
    trash_message: "delete",
    delete_draft: "delete",
    delete_label: "delete",
  });
  expect(entry?.read.filter((tool) => tool in entry.risky)).toEqual([]);
});
test("catalogEntry finds an entry by its ref and returns nothing for another ref or for undefined, and takes a catalog as a parameter", () => {
  expect(catalogEntry("connector:gmail")).toBe(CONNECTORS.at(0));
  expect(catalogEntry("other")).toBeUndefined();
  expect(catalogEntry(undefined)).toBeUndefined();
  const entry = CONNECTORS.at(0);
  if (!entry) throw new Error("Missing catalog entry");
  const other = { ...entry, ref: "connector:other" };
  expect(catalogEntry("connector:other", [other])).toBe(other);
  expect(catalogEntry("connector:gmail", [other])).toBeUndefined();
});
test("every risky tool of the entry is classified by the SDK classifyTool with the same action", () => {
  const entry = CONNECTORS.at(0);
  if (!entry) throw new Error("Missing catalog entry");
  for (const [tool, action] of Object.entries(entry.risky)) expect(classifyTool(tool)).toBe(action);
});
