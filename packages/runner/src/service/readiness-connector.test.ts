import { rmSync } from "node:fs";
import { ReadinessReport } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { FlowRow, Store } from "../storage.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { toReadinessReport } from "./map-flow.ts";
import { connectorReadiness } from "./readiness-connector.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing Gmail");
const gmail = entry;
const fact = { name: gmail.name, url: gmail.url, status: "connected" };
const connected = "The Gmail connector is connected in Claude Code.";
const signIn = "Sign in to Gmail at claude.ai/customize/connectors, then scan again on the Harnesses screen.";
const add =
  "Add the Gmail connector at claude.ai/customize/connectors, then scan again on the Harnesses screen.";
const manifest = FlowManifest.parse({
  format: "flowdriven-flow/1.1",
  id: "local.test",
  name: "Test",
  kind: "light",
  requirements: [
    { id: "gmail", type: "mcp_server", ref: "connector:gmail", tools: ["search_threads"] },
    { id: "other", type: "mcp_server", ref: "connector:other", tools: ["read"] },
  ],
  steps: [{ id: "s", do: "worker", instructions: "Read", uses: ["gmail"], checks: [{ type: "user" }] }],
});
const date = "2026-11-12T00:00:00.000Z";
const row: FlowRow = {
  id: manifest.id,
  version: manifest.version,
  hash: `sha256:${"a".repeat(64)}`,
  manifest,
  files: {},
  registeredAt: date,
};
const homes: string[] = [];
const stores: Store[] = [];
const services: RunnerService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
test("a connected Gmail fact is ok with the connected sentence", () => {
  expect(connectorReadiness(gmail, [fact])).toEqual({ state: "ok", detail: connected });
});
test("a needs_login fact is needs_login with the sign-in fix, and a failed, a pending, another url and no fact are missing with the add fix", () => {
  expect(connectorReadiness(gmail, [{ ...fact, status: "needs_login" }])).toEqual({
    state: "needs_login",
    detail: signIn,
  });
  for (const facts of [
    [{ ...fact, status: "failed" }],
    [{ ...fact, status: "pending" }],
    [{ ...fact, url: "https://other.example/" }],
    [],
  ])
    expect(connectorReadiness(gmail, facts)).toEqual({ state: "missing", detail: add });
});
test("toReadinessReport gives the Gmail row its state, route Gmail connector in Claude Code and risk official, leaves it unchecked when connectors is undefined, and leaves an mcp_server with another ref unchecked", () => {
  const report = toReadinessReport(row, date, undefined, [fact]);
  expect(report.items.at(0)).toMatchObject({
    state: "ok",
    detail: connected,
    route: { via: "Gmail connector in Claude Code", risk: "official" },
  });
  expect(report.items.at(1)?.state).toBe("unchecked");
  expect(toReadinessReport(row, date).items.at(0)?.state).toBe("unchecked");
  expect(toReadinessReport(row, date, undefined, []).items.at(0)).toMatchObject({
    state: "missing",
    detail: add,
    guide: { steps: [add], commands: [], verified: false },
  });
});
test("readiness.check through the service after a rescan reports the Gmail row ok", {
  timeout: 20_000,
}, async () => {
  const home = makeFakeHome({
    connectors: {
      [gmail.name]: {
        url: gmail.url,
        id: `mcpsrv_${"a".repeat(24)}`,
        tools: [{ name: "search_threads", readOnly: true }],
      },
    },
  });
  homes.push(home);
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const service = createRunnerService({
    store,
    dataDir: home,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH },
    claudePath: FAKE_CLAUDE_PATH,
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {} },
  });
  services.push(service);
  await service.start().settled;
  service.engine.registerFlow(manifest, row.hash);
  await service.call("harnesses.rescan", {});
  const report = ReadinessReport.parse(await service.call("readiness.check", { flowId: manifest.id }));
  expect(report.items.at(0)).toMatchObject({
    state: "ok",
    detail: connected,
    route: { via: "Gmail connector in Claude Code", risk: "official" },
  });
});
