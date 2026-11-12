import { rmSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { buildConnectorScanArgs } from "./args.ts";
import { parseConnectors, readConnectors } from "./connector-scan.ts";
import { readInventory } from "./inventory.ts";

const name = "claude.ai Gmail",
  url = "https://mail.example.test/mcp",
  id = `mcpsrv_${"a".repeat(24)}`;
const connector = { url, id, tools: [{ name: "search_threads", readOnly: true }, { name: "delete_draft" }] };
const homes: string[] = [];
function home(extra: object = {}) {
  const h = makeFakeHome({ connectors: { [name]: connector }, ...extra });
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const opts = (h: string) => ({
  claude: FAKE_CLAUDE_PATH,
  cwd: h,
  env: { HOME: h, PATH: process.env.PATH },
  waitMs: 1000,
  pollMs: 10,
  settleMs: 0,
  connectorSettleMs: 0,
});
const server = (status = "connected") => ({
  name,
  status,
  scope: "claudeai",
  config: { type: "claudeai-proxy", url, id },
  tools: [{ name: "search_threads", annotations: { readOnly: true } }],
});
test("parseConnectors keeps only claudeai servers with a claudeai-proxy config and maps the four statuses", () => {
  expect(
    parseConnectors({
      mcpServers: [
        server(),
        server("needs-auth"),
        server("pending"),
        server("other"),
        { ...server(), scope: "user" },
        { ...server(), config: { type: "other", url, id } },
      ],
    }).map((x) => x.status),
  ).toEqual(["connected", "needs_login", "pending", "failed"]);
  expect(parseConnectors({ mcpServers: [server("pending")] }).at(0)?.tools).toEqual([]);
});
test("a server with an id that does not match /^mcpsrv_[A-Za-z0-9]{1,60}$/, a tool name with a hidden character, and counts beyond 40 connectors and 200 tools are dropped or cut", () => {
  const tools = [
    ...Array.from({ length: 201 }, (_, i) => ({ name: `t${i}` })),
    { name: `a${String.fromCodePoint(0x202e)}` },
  ];
  const result = parseConnectors({
    mcpServers: [
      { ...server(), config: { type: "claudeai-proxy", url, id: "invalid" } },
      ...Array.from({ length: 41 }, () => ({ ...server(), tools })),
    ],
  });
  expect(result).toHaveLength(40);
  expect(result.at(0)?.tools).toHaveLength(200);
  expect(
    parseConnectors({
      mcpServers: [{ ...server(), tools: [{ name: `a${String.fromCodePoint(0x202e)}` }, { name: "" }] }],
    }).at(0)?.tools,
  ).toEqual([]);
});
test("readOnly is true only when the annotation says readOnly true", () => {
  expect(
    parseConnectors({
      mcpServers: [
        {
          ...server(),
          tools: [
            { name: "a", annotations: { readOnly: true } },
            { name: "b", annotations: { readOnly: "true" } },
            { name: "c" },
          ],
        },
      ],
    }).at(0)?.tools,
  ).toEqual([
    { name: "a", readOnly: true },
    { name: "b", readOnly: false },
    { name: "c", readOnly: false },
  ]);
});
test("readConnectors returns the facts of a connected Gmail, and the call log shows the arguments of G4 with no --restricted, no prompt, and only initialize and mcp_status lines", {
  timeout: 20_000,
}, async () => {
  const h = home();
  expect(await readConnectors(opts(h))).toEqual([
    {
      name,
      url,
      id,
      status: "connected",
      tools: [
        { name: "search_threads", readOnly: true },
        { name: "delete_draft", readOnly: false },
      ],
    },
  ]);
  const calls = readFakeCalls(h);
  expect(calls.filter((c) => c.kind === "control").map((c) => c.subtype)).toEqual([
    "initialize",
    "mcp_status",
  ]);
  expect(calls.at(0)).toMatchObject({ kind: "call", args: buildConnectorScanArgs() });
  expect(calls.at(0)).not.toHaveProperty("prompt");
});
test("the scan sends no prompt and is not restricted: no call line has a prompt and none has --restricted or --strict-mcp-config", {
  timeout: 20_000,
}, async () => {
  const h = home();
  await readConnectors(opts(h));
  const args = buildConnectorScanArgs();
  expect(args).not.toContain("--restricted");
  expect(args).not.toContain("--strict-mcp-config");
  for (const c of readFakeCalls(h))
    if (c.kind === "call") {
      expect(c).not.toHaveProperty("prompt");
      expect(c.args).not.toContain("--restricted");
      expect(c.args).not.toContain("--strict-mcp-config");
    }
});
test("pending connectors are asked again after pollMs until none is pending", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectorPending: 2 });
  expect((await readConnectors(opts(h)))?.at(0)?.status).toBe("connected");
  expect(readFakeCalls(h).filter((c) => c.kind === "control" && c.subtype === "mcp_status")).toHaveLength(3);
});
test("when a connector is still pending at waitMs the last answer is returned", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectorPending: 10000 });
  expect((await readConnectors({ ...opts(h), waitMs: 300, pollMs: 10 }))?.at(0)?.status).toBe("pending");
});
test("a child that never answers gives undefined within waitMs, and the child process is gone afterwards", {
  timeout: 20_000,
}, async () => {
  const h = home({ hang: ["status"] });
  expect(await readConnectors({ ...opts(h), waitMs: 300 })).toBeUndefined();
  const call = readFakeCalls(h).find((c) => c.kind === "call");
  if (!call || call.kind !== "call") throw Error("Missing call");
  expect(() => process.kill(call.pid, 0)).toThrow();
});
test("readInventory with withMcp returns connectors and without withMcp leaves the key out", {
  timeout: 20_000,
}, async () => {
  const h = home();
  expect(await readInventory({ ...opts(h), withMcp: true })).toHaveProperty("connectors", [
    expect.objectContaining({ id }),
  ]);
  expect(await readInventory({ ...opts(h), withMcp: false })).not.toHaveProperty("connectors");
});

const slowName = "claude.ai Slow";
const slowConnector = { ...connector, id: "mcpsrv_slow", status: "pending" as const };
const statusCalls = (h: string) =>
  readFakeCalls(h).filter((call) => call.kind === "control" && call.subtype === "mcp_status");

test("with names, a pending connector outside the names does not delay the answer: the first mcp_status is enough and that connector is returned as pending", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectors: { [name]: connector, [slowName]: slowConnector } });
  const result = await readConnectors({ ...opts(h), names: [name] });
  expect(result).toEqual([
    expect.objectContaining({ name, status: "connected" }),
    expect.objectContaining({ name: slowName, status: "pending", tools: [] }),
  ]);
  expect(statusCalls(h)).toHaveLength(1);
});

test("with names, the scan goes on while a named connector is pending and stops when it is connected (connectorPending)", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectors: { [name]: connector, [slowName]: slowConnector }, connectorPending: 2 });
  const result = await readConnectors({ ...opts(h), names: [name] });
  expect(result).toEqual([
    expect.objectContaining({ name, status: "connected" }),
    expect.objectContaining({ name: slowName, status: "pending" }),
  ]);
  expect(statusCalls(h)).toHaveLength(3);
});

test("without names the scan waits for every connector until its deadline, as before", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectors: { [name]: connector, [slowName]: slowConnector } });
  const result = await readConnectors({ ...opts(h), waitMs: 500, pollMs: 10 });
  expect(result).toEqual([
    expect.objectContaining({ name, status: "connected" }),
    expect.objectContaining({ name: slowName, status: "pending" }),
  ]);
  expect(statusCalls(h).length).toBeGreaterThan(1);
});

test("readInventory passes the catalog names: a rescan with a slow connector FlowDriven does not use returns the Gmail fact after one answer", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectors: { [name]: connector, [slowName]: slowConnector } });
  const result = await readInventory({ ...opts(h), withMcp: true, mcpTimeoutMs: 3000 });
  expect(result.connectors).toEqual([
    expect.objectContaining({ name, status: "connected" }),
    expect.objectContaining({ name: slowName, status: "pending" }),
  ]);
  expect(statusCalls(h)).toHaveLength(1);
});

test("an answer that does not list a named connector yet is not the end: the scan asks again and returns the connector once it is listed and connected (connectorAbsent)", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectorAbsent: 2 });
  expect(await readConnectors({ ...opts(h), names: [name], settleMs: 800 })).toEqual([
    expect.objectContaining({ name, status: "connected" }),
  ]);
  expect(statusCalls(h)).toHaveLength(3);
});

test("a named connector that never appears ends the scan after settleMs with the list it has, well before the deadline", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectors: { [slowName]: slowConnector } });
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 100));
  try {
    expect(
      await readConnectors({ ...opts(h), names: [name], settleMs: 250, pollMs: 0, waitMs: 5000 }),
    ).toEqual([expect.objectContaining({ name: slowName, status: "pending" })]);
    expect(statusCalls(h).length).toBeGreaterThan(1);
    expect(now).toBeLessThan(5000);
  } finally {
    clock.mockRestore();
  }
});

test("when every named connector is listed and connected the scan stops at once, before settleMs", {
  timeout: 20_000,
}, async () => {
  const h = home();
  expect(await readConnectors({ ...opts(h), names: [name], settleMs: 800 })).toEqual([
    expect.objectContaining({ name, status: "connected" }),
  ]);
  expect(statusCalls(h)).toHaveLength(1);
});

test("without names an empty first answer before settleMs is asked again, and the scan ends after settleMs when nothing is pending", {
  timeout: 20_000,
}, async () => {
  const h = home({ connectorAbsent: 1 });
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 100));
  try {
    expect(await readConnectors({ ...opts(h), settleMs: 450, pollMs: 0, waitMs: 5000 })).toEqual([
      expect.objectContaining({ name, status: "connected" }),
    ]);
    expect(statusCalls(h).length).toBeGreaterThan(1);
    expect(now).toBeGreaterThanOrEqual(450);
  } finally {
    clock.mockRestore();
  }
});

test("settleMs is never more than waitMs", { timeout: 20_000 }, async () => {
  const h = home({ connectorAbsent: 10000 });
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 100));
  try {
    expect(
      await readConnectors({ ...opts(h), names: [name], settleMs: 5000, waitMs: 1000, pollMs: 0 }),
    ).toEqual([]);
    expect(statusCalls(h).length).toBeGreaterThan(1);
    expect(now).toBeGreaterThanOrEqual(1000);
  } finally {
    clock.mockRestore();
  }
});
