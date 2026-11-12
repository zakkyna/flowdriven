import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { r4Flow } from "../test-helpers/trigger-rig.ts";
import { nativeHostPath, WEB_FIX, webReadiness } from "./readiness-web.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const active: { store: Store; service: RunnerService }[] = [];
afterEach(() => {
  for (const { service, store } of active.splice(0)) {
    service.stop();
    store.close();
  }
  cleanup();
});
const hash = `sha256:${"1".repeat(64)}`;
const manifest = (own = true) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.readiness",
    name: "Readiness",
    kind: "light",
    requirements: own
      ? [
          { id: "web", type: "web", mode: "read", session: "own", url_patterns: ["https://example.com/"] },
          { id: "managed", type: "web", mode: "read", session: "managed" },
          { id: "path", type: "path", ref: "notes" },
        ]
      : [{ id: "path", type: "path", ref: "notes" }],
    steps: [
      {
        id: "worker",
        do: "worker",
        instructions: "Work",
        checks: [{ type: "user" }],
        uses: own ? ["web"] : ["path"],
      },
    ],
    triggers: [{ kind: "schedule", every: "1h" }],
  });
async function setup(own = true, webCheck?: () => { chromeFlag: boolean; hostFile: boolean }) {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: tempPath(),
    mode: "live",
    harness: scriptedHarness({ steps: {} }),
    webCheck,
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {} },
  });
  active.push({ store, service });
  service.engine.registerFlow(manifest(own), hash);
  return service;
}

test("webReadiness is ok with the flag and the file and missing with the fix text otherwise (three cases)", () => {
  expect(webReadiness({ chromeFlag: true, hostFile: true })).toEqual({
    state: "ok",
    detail:
      "Claude Code can use the browser and the extension's host is installed. The browser with the Claude extension must be open.",
  });
  for (const value of [
    { chromeFlag: false, hostFile: true },
    { chromeFlag: true, hostFile: false },
    { chromeFlag: false, hostFile: false },
  ])
    expect(webReadiness(value)).toEqual({ state: "missing", detail: WEB_FIX });
});
test("nativeHostPath is the F13 path under the injected home", () => {
  expect(nativeHostPath("/home/example")).toBe(
    "/home/example/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json",
  );
});
test("readiness.check marks the own-browser web row ok or missing with the unofficial route and the guide, and every other row stays unchecked", async () => {
  for (const flag of [true, false]) {
    const service = await setup(true, () => ({ chromeFlag: flag, hostFile: true }));
    const result = await service.call("readiness.check", { flowId: "local.readiness" });
    const { ReadinessReport } = await import("@flowdriven/contracts");
    const rows = ReadinessReport.parse(result).items;
    expect(rows.at(0)).toMatchObject({
      state: flag ? "ok" : "missing",
      detail: flag
        ? "Claude Code can use the browser and the extension's host is installed. The browser with the Claude extension must be open."
        : WEB_FIX,
      route: {
        via: "Claude in Chrome inside Claude Code",
        risk: "unofficial",
        note: "This uses your personal browser. Every site you are logged into is reachable from it.",
      },
      guide: { steps: [WEB_FIX], commands: ["claude --chrome"], verified: false },
    });
    expect(rows.slice(1).map((row) => row.state)).toEqual(["unchecked", "unchecked"]);
  }
});
test("without a check function the report is the present one", async () => {
  const service = await setup();
  const { ReadinessReport } = await import("@flowdriven/contracts");
  const rows = ReadinessReport.parse(
    await service.call("readiness.check", { flowId: "local.readiness" }),
  ).items;
  expect(
    rows.every(
      (row) =>
        row.state === "unchecked" &&
        row.detail === "Not checked yet. Checking requirements arrives with the readiness engine.",
    ),
  ).toBe(true);
});
test("triggers.setEnabled(true) for a flow that needs the allow is refused until it is given", async () => {
  const service = await setup();
  const input = { flowId: "local.readiness", index: 0, enabled: true, hash };
  await expect(service.call("triggers.setEnabled", input)).rejects.toMatchObject({
    code: "not_allowed",
    message: "Allow what this flow may touch on its screen first.",
  });
  await service.call("flows.allowCapabilities", { flowId: input.flowId, hash });
  expect(await service.call("triggers.setEnabled", input)).toMatchObject({ state: "on" });
});
test("for a flow that does not need the allow, and for turning a trigger off, nothing changes", async () => {
  const plain = await setup(false);
  const input = { flowId: "local.readiness", index: 0, enabled: true, hash };
  expect(await plain.call("triggers.setEnabled", input)).toMatchObject({ state: "on" });
  const web = await setup();
  expect(await web.call("triggers.setEnabled", { ...input, enabled: false })).toMatchObject({ state: "off" });
});
test("a flow that needs the allow and cannot run unattended is refused with its own reason, not with the allow sentence", async () => {
  const service = await setup();
  const store = active.at(-1)?.store;
  if (!store) throw new Error("Missing store");
  const flow = r4Flow("local.unsafe");
  store.putFlow({
    id: flow.id,
    version: flow.version,
    hash,
    manifest: flow,
    files: {},
    registeredAt: "2026-11-12T00:00:00.000Z",
  });
  await expect(
    service.call("triggers.setEnabled", { flowId: flow.id, index: 0, enabled: true, hash }),
  ).rejects.toMatchObject({
    code: "not_allowed",
    message: "This flow cannot run unattended: unattended prefix at steps.0",
  });
});
