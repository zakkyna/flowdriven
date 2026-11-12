import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import type { StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { POST_TEXT } from "./browser-post.ts";
import * as childModule from "./child.ts";
import { CONNECTOR_DENY, CONNECTOR_STOP } from "./connector.ts";
import { tripSentence } from "./stream.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing connector");
const gmail = entry;
const fact = {
  name: gmail.name,
  url: gmail.url,
  id: `mcpsrv_${"a".repeat(24)}`,
  status: "connected" as const,
  tools: [
    ...gmail.read.map((name) => ({ name, readOnly: true })),
    ...Object.keys(gmail.risky).map((name) => ({ name, readOnly: false })),
  ],
};
const requirement = Requirement.parse({
  id: "gmail",
  type: "mcp_server",
  ref: "connector:gmail",
  connect: "native",
  tools: ["search_threads", "delete_draft"],
});
const route = routeRequirement(requirement, { hooks: true, chrome: false, connectors: [fact] });
if (!route?.routed) throw new Error("Missing route");
const routed = route;
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const result: FakeAction = { do: "result", result: "done" };
const tool = (id: string, name = "search_threads", extra: object = {}): FakeAction => ({
  do: "tool",
  id,
  name: gmail.prefix + name,
  input: { query: "test" },
  ...extra,
});
function setup(actions: FakeAction[] = [result], init?: Record<string, unknown>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const connectors = { [gmail.name]: { url: fact.url, id: fact.id, tools: fact.tools } };
  const home = makeFakeHome({ connectors, plays: [{ when: "", actions, ...(init ? { init } : {}) }] });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(project);
  const audits: { kind: string; detail: unknown }[] = [];
  const options = {
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind: string, _run: string, detail: unknown) => audits.push({ kind, detail }),
    newId: () => "cc-1",
    newSessionId: () => "session-1",
    rounds: 20,
    connectors: () => [fact],
  };
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Read",
    uses: ["gmail"],
    project,
    requirements: [requirement],
    routes: [routed],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  const script = (next: FakeAction[], override?: Record<string, unknown>) =>
    writeFakeScript(home, {
      connectors,
      plays: [{ when: "", actions: next, ...(override ? { init: override } : {}) }],
    });
  return { root, home, options, request, audits, script, adapter: createClaudeAdapter(options) };
}
const timeout = { timeout: 20_000 };
test(
  "a connector step starts the child with --mcp-config pointing at a file that holds one claudeai-proxy entry with the id and toolPermissions blocking every scan tool that is not declared",
  timeout,
  async () => {
    const t = setup();
    let config: unknown;
    let args: readonly string[] = [];
    const original = childModule.startChild;
    vi.spyOn(childModule, "startChild").mockImplementation((command, argv, options) => {
      args = argv;
      const path = argv.at(argv.indexOf("--mcp-config") + 1);
      if (!path) throw Error("Missing config");
      config = JSON.parse(readFileSync(path, "utf8"));
      return original(command, argv, options);
    });
    await t.adapter.runStep(t.request);
    expect(args).toContain("--restricted");
    expect(config).toEqual({
      mcpServers: {
        [gmail.name]: {
          type: "claudeai-proxy",
          url: fact.url,
          id: fact.id,
          toolPermissions: Object.fromEntries(
            fact.tools
              .filter((x) => !["search_threads", "delete_draft"].includes(x.name))
              .map((x) => [x.name, "blocked"]),
          ),
        },
      },
    });
  },
);
test("the config file is mode 0600 and the control folder is gone when the step ends", timeout, async () => {
  const t = setup();
  let mode = 0;
  await t.adapter.runStep({
    ...t.request,
    onStart: () => {
      mode = statSync(join(t.options.controlRoot, "cc-1", "mcp.json")).mode & 0o777;
    },
  });
  expect(mode).toBe(0o600);
  expect(existsSync(join(t.options.controlRoot, "cc-1"))).toBe(false);
});
test(
  "a declared read tool is allowed, its result reaches the worker as the runner's answer, and the step ends ok with outside true",
  timeout,
  async () => {
    const t = setup([tool("a", "search_threads", { result: "checked text" }), result]);
    let output = "";
    const original = childModule.startChild;
    vi.spyOn(childModule, "startChild").mockImplementation((...args) => {
      const child = original(...args);
      child.stdout.on("data", (b: Buffer) => {
        output += b.toString();
      });
      return child;
    });
    expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok", outside: true });
    expect(readFakeCalls(t.home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool", id: "a", ran: true }),
        expect.objectContaining({ kind: "post", id: "a", replaced: true }),
      ]),
    );
    expect(output).toContain("checked text");
  },
);
test(
  "the first allowed connector call calls onOutside before the result and the mark stays when the step then fails",
  timeout,
  async () => {
    const t = setup([tool("a"), { do: "exit", code: 1 }]);
    const onOutside = vi.fn();
    let markedBeforeResult = false;
    const original = childModule.startChild;
    vi.spyOn(childModule, "startChild").mockImplementation((...args) => {
      const child = original(...args);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes('"tool_result"'))
          markedBeforeResult = onOutside.mock.calls.length === 1;
      });
      return child;
    });
    expect(await t.adapter.runStep({ ...t.request, onOutside })).toMatchObject({
      exit: "failed",
      outside: true,
    });
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(markedBeforeResult).toBe(true);
  },
);
test(
  "a tool the flow does not declare is refused with This step does not declare the tool and is listed as tool_denied",
  timeout,
  async () => {
    const t = setup([tool("a", "get_thread"), result]);
    await t.adapter.runStep(t.request);
    expect(readFakeCalls(t.home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "a", ran: false }),
    );
    expect(t.audits).toContainEqual(
      expect.objectContaining({
        kind: "tool_denied",
        detail: expect.objectContaining({
          reason: `This step does not declare the tool ${gmail.prefix}get_thread.`,
        }),
      }),
    );
  },
);
test(
  "the audit has connector_call for each allowed call with requirementId, tool and class read, and no audit row, prompt or sentence holds the id or the url",
  timeout,
  async () => {
    const t = setup([tool("a"), tool("b"), result]);
    const outcome = await t.adapter.runStep(t.request);
    expect(t.audits.filter((a) => a.kind === "connector_call")).toEqual(
      [1, 2].map(() => ({
        kind: "connector_call",
        detail: {
          stepId: "s",
          itemKey: "",
          attempt: 1,
          requirementId: "gmail",
          tool: "search_threads",
          class: "read",
        },
      })),
    );
    const text = JSON.stringify([
      t.audits,
      outcome,
      readFakeCalls(t.home)
        .filter((c) => c.kind === "call")
        .map((c) => c.prompt),
    ]);
    expect(text).not.toContain(fact.id);
    expect(text).not.toContain(fact.url);
  },
);
test(
  "a result that is not text (an image block) is withheld: the worker gets the fixed sentence, the audit has connector_withheld with why unchecked, and the step goes on to its result",
  timeout,
  async () => {
    const t = setup([tool("a", "search_threads", { blocks: [{ type: "image", data: "abc" }] }), result]);
    let output = "";
    const original = childModule.startChild;
    vi.spyOn(childModule, "startChild").mockImplementation((...args) => {
      const child = original(...args);
      child.stdout.on("data", (b: Buffer) => {
        output += b.toString();
      });
      return child;
    });
    expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
    expect(output).toContain(POST_TEXT.unchecked);
    expect(t.audits).toContainEqual({
      kind: "connector_withheld",
      detail: {
        stepId: "s",
        itemKey: "",
        attempt: 1,
        requirementId: "gmail",
        tool: "search_threads",
        why: "unchecked",
      },
    });
  },
);
test(
  "a connector tool called without the pre hook (ungated) trips the wire and blocks the step with the tripwire sentence",
  timeout,
  async () => {
    const t = setup([{ do: "ungated", id: "a", name: gmail.prefix + "search_threads" }, result]);
    expect(await t.adapter.runStep(t.request)).toMatchObject({
      block: tripSentence(gmail.prefix + "search_threads"),
    });
  },
);
test(
  "the 21st connector call of an attempt is refused with This step called the connector too many times.",
  timeout,
  async () => {
    const t = setup([...Array.from({ length: 21 }, (_, i) => tool(`a${i}`)), result]);
    await t.adapter.runStep(t.request);
    expect(readFakeCalls(t.home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "a20", ran: false }),
    );
    expect(t.audits).toContainEqual(
      expect.objectContaining({
        kind: "tool_denied",
        detail: expect.objectContaining({ reason: CONNECTOR_DENY.tooMany }),
      }),
    );
  },
);
test(
  "a connector that is pending, failed or needs-auth at the start blocks the step with The Gmail connector is not connected in Claude Code. Scan again on the Harnesses screen. and no tool runs",
  timeout,
  async () => {
    for (const status of ["pending", "failed", "needs-auth"]) {
      const t = setup([tool("a"), result], { mcp_servers: [{ name: gmail.name, status }] });
      expect(await t.adapter.runStep(t.request)).toMatchObject({ block: CONNECTOR_STOP.down("Gmail") });
      expect(readFakeCalls(t.home).filter((c) => c.kind === "tool")).toEqual([]);
    }
  },
);
test(
  "an extra tool in the init event (play.init) blocks the step with The connector's tools changed since the last scan. Scan again on the Harnesses screen.",
  timeout,
  async () => {
    const t = setup([result], {
      tools: [gmail.prefix + "search_threads", gmail.prefix + "delete_draft", gmail.prefix + "get_thread"],
    });
    expect(await t.adapter.runStep(t.request)).toMatchObject({ block: CONNECTOR_STOP.changed });
  },
);
test("with no fact for the connector the step is blocked before any child starts", timeout, async () => {
  const t = setup();
  const spy = vi.spyOn(childModule, "startChild");
  expect(await createClaudeAdapter({ ...t.options, connectors: () => [] }).runStep(t.request)).toMatchObject({
    block: CONNECTOR_STOP.down("Gmail"),
  });
  expect(spy).not.toHaveBeenCalled();
});
