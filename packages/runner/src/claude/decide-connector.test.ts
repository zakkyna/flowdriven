import { expect, test } from "vitest";
import { callGrant, digestCall, pickGrant } from "../connectors/grants.ts";
import { CONNECTOR_DENY, type ConnectorPolicy, hideConnectorIds } from "./connector.ts";
import { DENY, decide } from "./decide.ts";
import type { Policy } from "./policy.ts";
import { visible } from "./text.ts";

const connector: ConnectorPolicy = {
  requirementId: "gmail",
  label: "Gmail",
  name: "claude.ai Gmail",
  url: "https://example.test",
  id: "mcpsrv_fake",
  prefix: "mcp__claude_ai_Gmail__",
  tools: ["search_threads", "delete_draft", "trash_thread"],
  read: ["search_threads"],
  risky: { delete_draft: "delete", trash_thread: "delete" },
  blocked: [],
};
const policy: Policy = {
  tools: [],
  folders: [],
  cwd: "",
  addDirs: [],
  schema: false,
  sessionId: "s1",
  connector,
};
const call = (name: string, input: unknown = {}) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  tool_name: connector.prefix + name,
  tool_input: input,
  tool_use_id: "t1",
});
const state = (grants: string[] = [], calls = 0) => ({
  calls,
  granted: (grant: string) => grants.includes(grant),
});
const decideCall = (name: string, input: unknown = {}, grants: string[] = [], calls = 0, p = policy) =>
  decide(p, call(name, input), undefined, state(grants, calls));

test("a declared read tool is allowed with effect connector and class read", () => {
  expect(decideCall("search_threads")).toEqual({
    allow: true,
    tool: connector.prefix + "search_threads",
    effect: "connector",
    connector: { requirementId: "gmail", tool: "search_threads", class: "read" },
  });
});
test("a tool the flow did not declare is refused with This step does not declare the tool and the full name through visible", () => {
  const name = `x${String.fromCodePoint(0x202e)}${"z".repeat(100)}`;
  expect(decideCall(name)).toMatchObject({
    allow: false,
    reason: `This step does not declare the tool ${visible(connector.prefix + name, 60)}.`,
  });
});
test("a declared risky tool with no grant is refused with the hold sentence and held carries requirementId, tool, input, digest and action delete", () => {
  const input = { id: "d1" };
  expect(decideCall("delete_draft", input)).toEqual({
    allow: false,
    tool: connector.prefix + "delete_draft",
    reason: CONNECTOR_DENY.held,
    held: {
      requirementId: "gmail",
      tool: "delete_draft",
      input,
      digest: digestCall("delete_draft", input),
      action: "delete",
    },
  });
});
test("a pick grant for <requirement>.<tool> allows the risky tool with any input and says grant pick", () => {
  const key = pickGrant("gmail", "delete_draft");
  for (const input of [{ id: "d1" }, { id: "other" }])
    expect(decideCall("delete_draft", input, [key])).toMatchObject({
      allow: true,
      effect: "connector",
      connector: {
        requirementId: "gmail",
        tool: "delete_draft",
        class: "risky",
        grant: { kind: "pick", key },
      },
    });
});
test("a call grant allows only the input it was digested from: a changed input, another tool and another requirement are held again", () => {
  const input = { id: "d1" };
  const key = callGrant("gmail", "delete_draft", digestCall("delete_draft", input));
  expect(decideCall("delete_draft", input, [key])).toMatchObject({
    allow: true,
    connector: { class: "risky", grant: { kind: "call", key } },
  });
  for (const result of [
    decideCall("delete_draft", { id: "d2" }, [key]),
    decideCall("trash_thread", input, [key]),
    decideCall("delete_draft", input, [key], 0, {
      ...policy,
      connector: { ...connector, requirementId: "other" },
    }),
  ])
    expect(result).toMatchObject({ allow: false, reason: CONNECTOR_DENY.held });
});
test("a grant for another tool or for another requirement does not allow it", () => {
  for (const key of [pickGrant("gmail", "trash_thread"), pickGrant("other", "delete_draft")])
    expect(decideCall("delete_draft", {}, [key])).toMatchObject({
      allow: false,
      reason: CONNECTOR_DENY.held,
    });
});
test("an input of exactly 16,000 bytes is allowed and one byte more is refused with This connector call is too large.", () => {
  expect(Buffer.byteLength(JSON.stringify({ x: "a".repeat(15992) }))).toBe(16000);
  expect(decideCall("search_threads", { x: "a".repeat(15992) }).allow).toBe(true);
  expect(decideCall("search_threads", { x: "a".repeat(15993) })).toMatchObject({
    allow: false,
    reason: CONNECTOR_DENY.tooLarge,
  });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(decideCall("search_threads", cyclic)).toMatchObject({
    allow: false,
    reason: CONNECTOR_DENY.tooLarge,
  });
});
test("the 20th connector call is allowed and the 21st is refused with This step called the connector too many times.", () => {
  expect(decideCall("search_threads", {}, [], 19).allow).toBe(true);
  expect(decideCall("search_threads", {}, [], 20)).toMatchObject({
    allow: false,
    reason: CONNECTOR_DENY.tooMany,
  });
});
test("with no connector state every connector call is refused, read tools included", () => {
  for (const name of connector.tools)
    expect(decide(policy, call(name))).toMatchObject({ allow: false, reason: CONNECTOR_DENY.tooMany });
});
test("a non-plain input is a bad request, a PostToolUse request is still a bad request, and a connector tool without a connector policy is refused as undeclared", () => {
  expect(decideCall("search_threads", [])).toMatchObject({ allow: false, reason: DENY.badRequest });
  expect(
    decide(policy, { ...call("search_threads"), hook_event_name: "PostToolUse" }, undefined, state()),
  ).toMatchObject({ allow: false, reason: DENY.badRequest });
  const { connector: _connector, ...noConnector } = policy;
  expect(decide(noConnector, call("search_threads"), undefined, state())).toMatchObject({
    allow: false,
    reason: `This step does not declare the tool ${connector.prefix}search_threads.`,
  });
});
test("the held input is a copy: changing the original after the decision does not change held.input", () => {
  const input = { nested: { id: "d1" } };
  const result = decideCall("delete_draft", input);
  input.nested.id = "changed";
  expect(result).toMatchObject({ allow: false, held: { input: { nested: { id: "d1" } } } });
});

test("hideConnectorIds replaces every connector id and leaves other text as it is", () => {
  expect(hideConnectorIds("before mcpsrv_Ab123, mcpsrv_X9! mcpsrv_ and mcpsrv_foo-bar after")).toBe(
    "before mcpsrv_[hidden], mcpsrv_[hidden]! mcpsrv_ and mcpsrv_[hidden]-bar after",
  );
});
