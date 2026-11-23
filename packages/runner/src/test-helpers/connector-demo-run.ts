import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { controlRoot } from "../claude/control.ts";
import { CONNECTORS } from "../connectors/catalog.ts";
import { createRunnerService, DEMO_HASH } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { AuditEntry } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakePlay,
  readFakeCalls,
  writeFakeScript,
} from "./fake-claude-script.ts";

const gmail = CONNECTORS.at(0);
if (!gmail) throw new Error("Missing Gmail catalog entry.");
const entry = gmail;
const address = "https://example.com/";
const invoke = (
  id: string,
  name: string,
  input: Record<string, unknown> = { id: "d1" },
  blocks?: unknown[],
): FakeAction => ({
  do: "tool",
  id,
  name: entry.prefix + name,
  input,
  ...(blocks ? { blocks } : {}),
  result: "ok",
});
const chrome = (id: string, name: string, input: Record<string, unknown>): FakeAction => ({
  do: "tool",
  id,
  name: `mcp__claude-in-chrome__${name}`,
  input,
});
const done: FakeAction = { do: "result", result: "ok" };
const worker = (id: string, title: string, instructions: string) => ({
  id,
  title,
  do: "worker",
  uses: ["gmail"],
  instructions,
  checks: [{ type: "contains", pattern: "ok" }],
});
function field(row: AuditEntry | undefined, key: string): string {
  const detail = row?.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "none";
  const value = detail[key];
  return typeof value === "string" ? value : "none";
}
export async function runConnectorDemo(
  options: { connectors?: boolean; root?: string } = {},
): Promise<string[]> {
  const base = options.root ?? tmpdir();
  const dataDir = realpathSync(mkdtempSync(join(base, "flowdriven- ")));
  const home = realpathSync(mkdtempSync(join(base, "flowdriven- ")));
  const connectors =
    options.connectors === false
      ? {}
      : {
          [entry.name]: {
            url: entry.url,
            id: `mcpsrv_${"a".repeat(24)}`,
            tools: [
              ...entry.read.map((name) => ({ name, readOnly: true })),
              ...Object.keys(entry.risky).map((name) => ({ name, readOnly: false })),
            ],
          },
        };
  const pages = { [address]: { title: "Moved", text: "Elsewhere", final: "https://other.example/page" } };
  const store = await openSqliteStore(":memory:");
  let id = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date("2026-11-12T00:00:00Z"),
    newId: (prefix) => `${prefix}-${++id}`,
    keeper: {
      probes: {
        refresh: async () => {},
        availableMb: () => 8000,
        pressureLevel: () => 1,
        groupRssMb: () => undefined,
        totalMb: () => 16000,
      },
      every: () => () => {},
    },
    triggers: { dayOf: () => "2026-11-12", every: () => () => {}, watch: () => () => {} },
  });
  let stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      service.stop();
      store.close();
    }
  };
  const script = (plays: FakePlay[]) => writeFakeScript(home, { chrome: true, connectors, pages, plays });
  try {
    script([]);
    await service.start().settled;
    await service.call("harnesses.rescan", {});
    await service.call("settings.update", { patch: { agentPermission: "on" } });
    const project = join(dataDir, "project");
    mkdirSync(project, { recursive: true });
    const start = async (name: string, steps: unknown[], plays: FakePlay[], browser = false) => {
      const requirements = browser
        ? [
            {
              id: "page",
              type: "web",
              mode: "read",
              session: "own",
              url_patterns: [address],
              rate: { per_run: 2 },
            },
          ]
        : [
            {
              id: "gmail",
              type: "mcp_server",
              ref: "connector:gmail",
              tools: ["search_threads", "delete_draft"],
            },
          ];
      const flow = FlowManifest.parse({
        format: "flowdriven-flow/1.1",
        id: `local.demo-${name}`,
        name,
        kind: "build",
        requirements,
        steps,
      });
      service.engine.registerFlow(flow, DEMO_HASH, {});
      store.putCapabilityConsent({ flowId: flow.id, hash: DEMO_HASH, at: "2026-11-12T00:00:00Z" });
      script(plays);
      return service.engine.startRun(flow.id, { project });
    };
    const read = await start(
      "read",
      [worker("read", "Read", "READ")],
      [
        {
          when: "READ",
          actions: [invoke("read", "search_threads"), invoke("undeclared", "get_thread"), done],
        },
      ],
    );
    const readAudit = store.listAudit(read.id);
    const call = readAudit.find((row) => row.kind === "connector_call");
    const denied = readAudit.find((row) => row.kind === "tool_denied");
    if (options.connectors === false) return [`list read: ${field(call, "tool")} (${field(call, "class")})`];
    const held = await start(
      "hold",
      [worker("hold", "Hold test", "HOLD")],
      [{ when: "HOLD", actions: [invoke("hold", "delete_draft"), done] }],
    );
    const approval = store.listApprovals({ runId: held.id, state: "pending" }).at(0);
    const heldLine = held.state === "waiting_approval" ? (approval?.summary ?? "none") : "none";
    if (!approval) throw new Error("Missing held approval.");
    await service.engine.decide(approval.id, "approve");
    const grant = store.listAudit(held.id).find((row) => row.kind === "grant_used");
    const changed = await start(
      "changed",
      [worker("hold", "Hold test", "CHANGE")],
      [{ when: "CHANGE", actions: [invoke("change", "delete_draft"), done] }],
    );
    const first = store.listApprovals({ runId: changed.id, state: "pending" }).at(0);
    if (!first) throw new Error("Missing changed-input approval.");
    script([{ when: "CHANGE", actions: [invoke("changed", "delete_draft", { id: "d2" }), done] }]);
    await service.engine.decide(first.id, "approve");
    const count = store
      .listApprovals({ runId: changed.id })
      .filter((row) => row.kind === "risky_action" && row.stepId === "hold").length;
    const find = {
      id: "find",
      do: "worker",
      instructions: "FIND",
      outputs: [
        { id: "jobs", type: "json" },
        { id: "note", type: "text" },
      ],
      checks: [{ type: "contains", of: "note", pattern: "ok" }],
    };
    const pick = {
      id: "pick",
      do: "ask",
      ask: {
        question: "Pick",
        choose_from: "${steps.find.outputs.jobs}",
        max_pick: 1,
        approves: ["gmail.delete_draft"],
      },
    };
    // A pick releases a call only inside a loop over the ask's choice (plan 05c, Decision 10): the loop
    // over the choice has no key, so its items take the pick keys; the step after the loop is held.
    const loop = {
      id: "loop",
      for_each: "${steps.pick.outputs.choice}",
      as: "job",
      steps: [worker("delete", "Delete", "DELETE ${job.id}")],
    };
    const later = worker("later", "Later", "LATER");
    const found = { report: "ok", outputs: { jobs: [{ id: "j1" }, { id: "j2" }], note: "ok" } };
    const plays: FakePlay[] = [
      {
        when: "FIND",
        actions: [
          { do: "tool", id: "found", name: "StructuredOutput", input: found },
          { do: "result", structured: found },
        ],
      },
      { when: "DELETE", actions: [invoke("delete", "delete_draft"), done] },
      { when: "LATER", actions: [invoke("later", "delete_draft"), done] },
    ];
    const picked = await start("pick", [find, pick, loop, later], plays);
    const choice = store.listApprovals({ runId: picked.id, state: "pending" }).at(0);
    if (!choice)
      throw new Error(
        `Missing choice: ${JSON.stringify({ picked, steps: store.listSteps(picked.id), audit: store.listAudit(picked.id) })}`,
      );
    await service.engine.answerAsk(choice.id, { picks: ["j1"] });
    const pickAudit = store.listAudit(picked.id);
    const used = pickAudit.find((row) => row.kind === "grant_used" && field(row, "grant") === "pick");
    const laterHeld = store
      .listApprovals({ runId: picked.id, state: "pending" })
      .find((approval) => approval.kind === "risky_action" && approval.stepId === "later");
    const image = await start(
      "image",
      [worker("image", "Image", "IMAGE")],
      [
        {
          when: "IMAGE",
          actions: [invoke("image", "search_threads", {}, [{ type: "image", data: "abc" }]), done],
        },
      ],
    );
    const withheld = store.listAudit(image.id).find((row) => row.kind === "connector_withheld");
    const moved = await start(
      "moved",
      [
        {
          id: "page",
          do: "worker",
          uses: ["page"],
          instructions: "MOVED",
          checks: [{ type: "contains", pattern: "ok" }],
        },
      ],
      [
        {
          when: "MOVED",
          actions: [
            chrome("context", "tabs_context_mcp", { createIfEmpty: true }),
            chrome("nav", "navigate", { tabId: 1001, url: address }),
            chrome("read-page", "get_page_text", { tabId: 1001 }),
            chrome("close", "tabs_close_mcp", { tabId: 1001 }),
            done,
          ],
        },
      ],
      true,
    );
    const closed = readFakeCalls(home).find(
      (call) => call.kind === "tool" && call.id === "close" && call.ran,
    );
    const lines = [
      `list read: ${field(call, "tool")} (${field(call, "class")})`,
      `undeclared tool refused: ${field(denied, "reason")}`,
      `risky call held: ${heldLine}`,
      `approved call ran: ${field(grant, "tool")} (${field(grant, "grant")})`,
      `changed input held again: ${count} approvals for the step`,
      `pick released one item: ${field(used, "itemKey")} ran in the loop over the choice, ${laterHeld ? "the call after the loop held" : "nothing held"}`,
      `non-text result withheld: ${field(withheld, "why")}`,
      `tab closed after a withheld page: ${closed ? "tab 1001 closed" : "none"}, step stopped: ${moved.blockedReason ?? "none"}`,
    ];
    stop();
    let left: string[] = [];
    try {
      left = readdirSync(controlRoot(dataDir));
    } catch {}
    if (left.length) throw new Error("The demo left a control folder behind.");
    return lines;
  } finally {
    stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
}
