import { RunDetail, TriggerStatus } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createFixtureRunnerClient } from "./client";

const flowId = "dev.example.job-review";
const setup = () => {
  const client = createFixtureRunnerClient({ scenario: "looped" });
  const flow = client.state.flows.find((item) => item.manifest.id === flowId);
  if (!flow) throw new Error("Missing looped flow");
  return { client, flow };
};

test("the looped flow lists a schedule, a file change and a webhook, and no manual entry", async () => {
  const { client } = setup();
  const statuses = await client.call("triggers.list", { flowId });
  expect(statuses.map(({ kind, index, summary }) => ({ kind, index, summary }))).toEqual([
    { kind: "schedule", index: 1, summary: "Every 1h" },
    { kind: "file_change", index: 2, summary: "Files change in inbox" },
    { kind: "webhook", index: 3, summary: "Called by a webhook" },
  ]);
  expect(statuses.at(1)).toMatchObject({
    state: "on",
    firesToday: 3,
    droppedToday: 2,
    dailyCap: 24,
    last: { outcome: "started", runId: "run-0008" },
  });
});

test("a webhook is unavailable with its reason and cannot be switched on", async () => {
  const { client, flow } = setup();
  expect((await client.call("triggers.list", { flowId })).at(2)).toMatchObject({
    state: "unavailable",
    canEnable: false,
    reason: "Not available yet.",
  });
  await expect(
    client.call("triggers.setEnabled", { flowId, index: 3, enabled: true, hash: flow.hash }),
  ).rejects.toMatchObject({ code: "not_allowed", message: "Not available yet." });
});

test("switching the schedule on stores the switch, returns an on status with a next run, and a later list shows it", async () => {
  const { client, flow } = setup();
  const status = await client.call("triggers.setEnabled", {
    flowId,
    index: 1,
    enabled: true,
    hash: flow.hash,
  });
  expect(status).toMatchObject({ state: "on", nextAt: "2026-11-10T10:30:00.000Z" });
  expect(client.state.triggerSwitches[`${flowId}#1`]).toEqual({ hash: flow.hash });
  expect((await client.call("triggers.list", { flowId })).at(0)).toEqual(status);
  await client.call("triggers.setEnabled", { flowId, index: 1, enabled: false, hash: flow.hash });
  expect(client.state.triggerSwitches[`${flowId}#1`]).toBeUndefined();
});

test("a stale hash is not_allowed; an unknown flow and an unknown index are not_found", async () => {
  const { client, flow } = setup();
  await expect(
    client.call("triggers.setEnabled", { flowId, index: 1, enabled: true, hash: `sha256:${"0".repeat(64)}` }),
  ).rejects.toMatchObject({
    code: "not_allowed",
    message: "This flow changed since you looked at it. Reload and check it again.",
  });
  await expect(client.call("triggers.list", { flowId: "unknown" })).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    client.call("triggers.setEnabled", { flowId: "unknown", index: 1, enabled: true, hash: flow.hash }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    client.call("triggers.setEnabled", { flowId, index: 99, enabled: true, hash: flow.hash }),
  ).rejects.toMatchObject({ code: "not_found" });
});

test("every status and the triggered run still validate against the contracts", async () => {
  const { client } = setup();
  const statuses = await client.call("triggers.list", { flowId });
  expect(statuses).toHaveLength(3);
  for (const status of statuses) expect(TriggerStatus.safeParse(status).success).toBe(true);
  const run = await client.call("runs.status", { runId: "run-0008" });
  expect(RunDetail.safeParse(run).success).toBe(true);
  expect(run.trigger).toEqual({ kind: "schedule", words: "Started by its schedule" });
});

test("a trigger switched on for an older hash shows needs_ok, and switching it on again with the current hash makes it on", async () => {
  const { client, flow } = setup();
  client.state.triggerSwitches[`${flowId}#1`] = { hash: `sha256:${"0".repeat(64)}` };
  expect((await client.call("triggers.list", { flowId })).at(0)).toMatchObject({
    state: "needs_ok",
    reason: "This flow changed. Turn the trigger on again to approve this version.",
  });
  expect(
    await client.call("triggers.setEnabled", { flowId, index: 1, enabled: true, hash: flow.hash }),
  ).toMatchObject({ state: "on" });
});
