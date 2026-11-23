import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { controlRoot } from "../claude/control.ts";
import { createRunnerService, DEMO_HASH } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { AuditEntry } from "../storage.ts";
import { FAKE_CLAUDE_PATH, type FakeAction, type FakeScript, writeFakeScript } from "./fake-claude-script.ts";

type Pages = NonNullable<FakeScript["pages"]>;
const ADDRESS = "https://example.com/";
const PREFIX = "mcp__claude-in-chrome__";
const OWNER_DAY = "2026-11-12";
const PAGE: Pages = {
  [ADDRESS]: { title: "Example Domain", text: "This domain is for use in illustrative examples." },
};
const tool = (id: string, name: string, input: Record<string, unknown>): FakeAction => ({
  do: "tool",
  id,
  name: `${PREFIX}${name}`,
  input,
});
const context = tool("context", "tabs_context_mcp", { createIfEmpty: true });
const navigate = (id: string, url = ADDRESS) => tool(id, "navigate", { tabId: 1001, url });
const read = (id: string) => tool(id, "get_page_text", { tabId: 1001 });
const done: FakeAction = { do: "result", result: "done" };

type Play = { flowId: string; marker: string; pages: Pages; actions: FakeAction[] };
function detailField(entry: AuditEntry, key: string): string | undefined {
  const detail = entry.detail;
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const value = detail[key];
  return typeof value === "string" ? value : undefined;
}

export async function runBrowserDemo(options: { pages?: Pages; root?: string } = {}): Promise<string[]> {
  const base = options.root ?? tmpdir();
  const dataDir = realpathSync(mkdtempSync(join(base, "flowdriven- ")));
  const home = realpathSync(mkdtempSync(join(base, "flowdriven- ")));
  const readPages = options.pages ?? PAGE;
  const plays: Play[] = [
    {
      flowId: "local.demo-read",
      marker: "PLAY-READ",
      pages: readPages,
      actions: [context, navigate("nav"), read("read"), done],
    },
    {
      flowId: "local.demo-click",
      marker: "PLAY-CLICK",
      pages: PAGE,
      actions: [context, tool("click", "computer", { action: "left_click", coordinate: [10, 10] }), done],
    },
    {
      flowId: "local.demo-address",
      marker: "PLAY-ADDRESS",
      pages: PAGE,
      actions: [context, navigate("evil", "https://evil.example/"), done],
    },
    {
      flowId: "local.demo-limit",
      marker: "PLAY-LIMIT",
      pages: PAGE,
      actions: [
        context,
        navigate("nav1"),
        read("read1"),
        navigate("nav2"),
        read("read2"),
        navigate("nav3"),
        done,
      ],
    },
    {
      flowId: "local.demo-moved",
      marker: "PLAY-MOVED",
      pages: { [ADDRESS]: { title: "Moved", text: "Elsewhere.", final: "https://other.example/page" } },
      actions: [context, navigate("nav"), read("read"), done],
    },
    {
      flowId: "local.demo-challenge",
      marker: "PLAY-CHALLENGE",
      pages: { [ADDRESS]: { title: "Just a moment...", text: "Checking your browser." } },
      actions: [context, navigate("nav"), read("read"), done],
    },
  ];
  const store = await openSqliteStore(":memory:");
  let id = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date("2026-11-12T00:00:00.000Z"),
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
    triggers: { dayOf: () => OWNER_DAY, every: () => () => {}, watch: () => () => {} },
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    service.stop();
    store.close();
  };
  try {
    writeFakeScript(home, { chrome: true, pages: PAGE, plays: [] });
    await service.start().settled;
    await service.call("settings.update", { patch: { agentPermission: "on" } });
    const project = join(dataDir, "project");
    mkdirSync(project, { recursive: true });
    const outcomes: { audit: AuditEntry[]; blockedReason: string | undefined }[] = [];
    for (const play of plays) {
      const flow = FlowManifest.parse({
        format: "flowdriven-flow/1.1",
        id: play.flowId,
        name: play.flowId,
        kind: "build",
        requirements: [
          {
            id: "jobs_web",
            type: "web",
            mode: "read",
            session: "own",
            sensitive: true,
            url_patterns: [ADDRESS],
            rate: { per_run: 2 },
            on_challenge: "stop",
          },
        ],
        steps: [
          {
            id: "page",
            do: "worker",
            uses: ["jobs_web"],
            instructions: `${play.marker} Open ${ADDRESS} and return its text.`,
            checks: [{ type: "contains", pattern: "done" }],
          },
        ],
      });
      service.engine.registerFlow(flow, DEMO_HASH, {});
      store.putCapabilityConsent({
        flowId: play.flowId,
        hash: DEMO_HASH,
        at: "2026-11-12T00:00:00.000Z",
      });
      writeFakeScript(home, {
        chrome: true,
        pages: play.pages,
        plays: [{ when: play.marker, actions: play.actions }],
      });
      const run = await service.engine.startRun(play.flowId, { project });
      outcomes.push({ audit: store.listAudit(run.id), blockedReason: run.blockedReason });
    }
    const [read1, click, address, limit, moved, challenge] = outcomes;
    const denied = (o: typeof read1) => o?.audit.find((entry) => entry.kind === "tool_denied");
    const refused = (label: string, o: typeof read1) =>
      `${label} refused: ${(o && denied(o) && detailField(denied(o) as AuditEntry, "reason")) || "none"}`;
    const pageRead = read1?.audit.find((entry) => entry.kind === "page_read");
    const readAddress = pageRead && detailField(pageRead, "address");
    // A page counts as read only when the made-up page table served it; a missing page is the fake's "Not found".
    const readLine =
      readAddress !== undefined && Object.hasOwn(readPages, readAddress)
        ? `page read: ${readAddress}`
        : "page read: none";
    const withheld = moved?.audit.find((entry) => entry.kind === "page_withheld");
    const lines = [
      readLine,
      refused("click", click),
      refused("address", address),
      refused("page limit", limit),
      `moved page withheld: ${(withheld && detailField(withheld, "sentence")) || "none"}`,
      `challenge blocked the run: ${challenge?.blockedReason ?? "none"}`,
    ];
    stop();
    // The control folder lives under the data folder; a leftover would be a leak.
    const left = (() => {
      try {
        return readdirSync(controlRoot(dataDir));
      } catch {
        return [];
      }
    })();
    if (left.length > 0) throw new Error("The demo left a control folder behind.");
    return lines;
  } finally {
    stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
}
