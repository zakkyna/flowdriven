import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const roots: string[] = [];
const services: RunnerService[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function rigOver(store: Store) {
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dataDir);
  let n = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "demo",
    now: () => new Date("2026-11-11T00:00:00.000Z"),
    newId: (prefix) => `${prefix}-${++n}`,
  });
  services.push(service);
  await service.start().settled;
  return service;
}
async function rig() {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const service = await rigOver(store);
  return { store, call: service.call };
}

test("the ceiling is set through settings.update, takes effect at once, keeps the other fields, and survives a restart", async () => {
  const s = await rig();
  expect(((await s.call("settings.get", {})) as Settings).keeper.ceiling).toBe(4);
  await s.call("settings.update", { patch: { keeper: { reserveMb: 2000, quotaLines: { sevenDay: 0.8 } } } });
  const next = (await s.call("settings.update", { patch: { keeper: { ceiling: 1 } } })) as Settings;
  expect(next.keeper).toMatchObject({
    ceiling: 1,
    reserveMb: 2000,
    quotaLines: { fiveHour: 0.9, sevenDay: 0.8 },
  });
  expect(readKeeperSettings(s.store)).toMatchObject({ ceiling: 1, reserveMb: 2000 });
  expect(((await (await rigOver(s.store)).call("settings.get", {})) as Settings).keeper.ceiling).toBe(1);
  await expect(s.call("settings.update", { patch: { brain: { main: "x" } } })).rejects.toThrow(
    "Changing settings arrives with the agent.",
  );
  await expect(s.call("settings.update", { patch: { keeper: { ceiling: 0 } } })).rejects.toThrow();
});

test("model patches keep other harnesses and mixed patches do not change settings", async () => {
  const s = await rig();
  const models = { low: "small", medium: "middle", high: "large" };
  const updated = (await s.call("settings.update", {
    patch: { keeper: { effortModels: { other: models } } },
  })) as Settings;
  expect(updated.keeper.effortModels).toEqual({
    "claude-code": { low: "haiku", medium: "sonnet", high: "opus" },
    other: models,
  });
  await expect(
    s.call("settings.update", { patch: { keeper: { ceiling: 2 }, offerSaveOneTime: true } }),
  ).rejects.toThrow("Changing settings arrives with the agent.");
  await expect(
    s.call("settings.update", { patch: { keeper: { ceiling: 2 }, unknown: true } }),
  ).rejects.toThrow("Changing settings arrives with the agent.");
  await expect(
    s.call("settings.update", { patch: { keeper: { ceiling: 2, unknown: true } } }),
  ).rejects.toThrow();
  expect(readKeeperSettings(s.store).ceiling).toBe(4);
});
