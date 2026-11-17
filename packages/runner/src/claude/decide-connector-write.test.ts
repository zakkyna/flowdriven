import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement, type Value } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import { callGrant, digestCall, pickGrant } from "../connectors/grants.ts";
import { routeRequirement } from "../router/route.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { type ConnectorPolicy, decideConnector } from "./connector.ts";
import { buildPolicy } from "./policy.ts";
import { buildPrompt } from "./prompt.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing Gmail");
const gmail = entry;
const policy = {
  requirementId: "gmail",
  label: "Gmail",
  name: gmail.name,
  url: gmail.url,
  id: "mcpsrv_fake",
  prefix: gmail.prefix,
  tools: ["create_draft", "label_thread", "mark_thread_spam"],
  read: [],
  write: ["create_draft", "label_thread"],
  labelTools: ["label_thread"],
  risky: { mark_thread_spam: "delete" },
  blocked: [],
} as ConnectorPolicy;
const decide = (name: string, input: Record<string, unknown>, grants: string[] = []) =>
  decideConnector(policy, name, input, { calls: 0, granted: (key) => grants.includes(key) });
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("create_draft and label_thread run without approval when declared, and the audit row says class write", {
  timeout: 20000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-write-")));
  roots.push(root);
  const tools = ["create_draft", "label_thread"];
  const fact = {
    name: gmail.name,
    url: gmail.url,
    id: `mcpsrv_${"a".repeat(24)}`,
    status: "connected" as const,
    tools: tools.map((name) => ({ name, readOnly: false })),
  };
  const connectors = { [gmail.name]: { url: fact.url, id: fact.id, tools: fact.tools } };
  const home = makeFakeHome({
    connectors,
    plays: [
      {
        when: "",
        actions: [
          ...tools.map((name, i) => ({
            do: "tool" as const,
            id: String(i),
            name: gmail.prefix + name,
            input: { label: "work" },
            result: "ok",
          })),
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(project);
  const req = Requirement.parse({ id: "gmail", type: "mcp_server", ref: gmail.ref, tools });
  const route = routeRequirement(req, { hooks: true, chrome: false, connectors: [fact] });
  const policyInput = {
    kind: "worker" as const,
    project,
    controlRoot: join(root, "control"),
    controlCwd: join(root, "control", "cwd"),
    sessionId: "session-1",
    schema: false,
    requirements: [req],
    routes: route ? [route] : [],
    connectors: [fact],
  };
  expect(buildPolicy(policyInput).connector).toMatchObject({ write: tools, labelTools: ["label_thread"] });
  for (const invalid of [
    [],
    [{ name: "create_draft", readOnly: false, destructive: true as const }, fact.tools[1]].filter(
      (tool) => tool !== undefined,
    ),
  ])
    expect(() => buildPolicy({ ...policyInput, connectors: [{ ...fact, tools: invalid }] })).toThrow();
  const audits: { kind: string; detail: unknown }[] = [];
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind, _run, detail) => audits.push({ kind, detail }),
    newId: () => "cc-1",
    newSessionId: () => "session-1",
    rounds: 20,
    connectors: () => [fact],
  });
  expect(
    await adapter.runStep({
      runId: "r1",
      stepId: "s",
      itemKey: "",
      attempt: 1,
      replan: false,
      kind: "worker",
      title: "t",
      instructions: "Write",
      uses: ["gmail"],
      project,
      requirements: [req],
      routes: route ? [route] : [],
      outputs: [],
      maxDurationMs: 10000,
      signal: new AbortController().signal,
    }),
  ).toMatchObject({ exit: "ok" });
  for (const tool of tools)
    expect(audits).toContainEqual(
      expect.objectContaining({
        kind: "connector_call",
        detail: expect.objectContaining({ tool, class: "write" }),
      }),
    );
});

test("a label call that names TRASH or SPAM, in any case and anywhere in the input, is held as a delete", () => {
  const inputs: Record<string, Value>[] = [
    { labels: ["TRASH"] },
    { nested: { spam: true } },
    { x: `a${String.fromCodePoint(0xff33, 0xff30, 0xff21, 0xff2d)}` },
    { x: `t${String.fromCodePoint(0x200b)}rash` },
  ];
  for (const input of inputs) {
    expect(decide("label_thread", input)).toMatchObject({ allow: false, held: { action: "delete", input } });
    const key = callGrant("gmail", "label_thread", digestCall("label_thread", input));
    expect(decide("label_thread", input, [key])).toMatchObject({
      allow: true,
      connector: { grant: { kind: "call", key } },
    });
    const pick = pickGrant("gmail", "label_thread");
    expect(decide("label_thread", input, [pick])).toMatchObject({
      allow: true,
      connector: { grant: { kind: "pick", key: pick } },
    });
  }
});
test("mark_thread_spam is held, and a pick grant releases it for a picked item", () => {
  expect(decide("mark_thread_spam", { id: "picked" })).toMatchObject({
    allow: false,
    held: { action: "delete" },
  });
  const key = pickGrant("gmail", "mark_thread_spam");
  expect(decide("mark_thread_spam", { id: "picked" }, [key])).toMatchObject({
    allow: true,
    connector: { class: "risky", grant: { kind: "pick", key } },
  });
});
test("the prompt names the write tools and the Trash and Spam rule only when the step declares them", () => {
  const base = { instructions: "Work", outputs: [] };
  const withLabels = buildPrompt({
    ...base,
    connector: {
      label: "Gmail",
      tools: [`${gmail.prefix}label_thread`],
      write: [`${gmail.prefix}label_thread`],
      labelHold: true,
    },
  });
  expect(withLabels).toContain(`These tools make changes without approval: ${gmail.prefix}label_thread.`);
  expect(withLabels).toContain(
    "A label change that moves mail to Trash or Spam is held until the owner approves it.",
  );
  const draftOnly = buildPrompt({
    ...base,
    connector: {
      label: "Gmail",
      tools: [`${gmail.prefix}create_draft`],
      write: [`${gmail.prefix}create_draft`],
    },
  });
  expect(draftOnly).toContain(`These tools make changes without approval: ${gmail.prefix}create_draft.`);
  expect(draftOnly).not.toContain("Trash or Spam");
  const readOnly = buildPrompt({
    ...base,
    connector: { label: "Gmail", tools: [`${gmail.prefix}search_threads`] },
  });
  expect(readOnly).not.toContain("without approval");
  expect(readOnly).not.toContain("Trash or Spam");
});
