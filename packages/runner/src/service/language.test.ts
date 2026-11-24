import { tmpdir } from "node:os";
import { expect, test, vi } from "vitest";
import { createServiceHarness } from "../test-helpers/service-harness.ts";
import { createNotifier } from "./notify-wiring.ts";
import { createRunnerService } from "./service.ts";

const codes = ["en", "id"];
test("TC-j30-01 TC-STO-28 defaults and registered languages", async () => {
  const h = await createServiceHarness(tmpdir());
  try {
    expect(await h.call("settings.get", {})).toMatchObject({
      language: "en",
      agentPermission: "unset",
      mainAgent: null,
      busyFallback: false,
      spendingLimit: 10,
    });
    expect(await h.call("settings.get", {})).not.toHaveProperty("background");
    h.store.putSetting("language", "xx");
    expect(await h.call("settings.get", {})).toMatchObject({ language: "en" });
    await expect(h.call("settings.update", { patch: { language: "xx" } })).rejects.toMatchObject({
      code: "invalid_input",
      reason: "language_unknown",
    });
    expect(h.store.getSetting("language")).toBe("xx");
    const s = createRunnerService({
      store: h.store,
      dataDir: h.dataDir,
      mode: "demo",
      languages: ["en", "id", "xx"],
    });
    expect(await s.call("settings.update", { patch: { language: "xx" } })).toMatchObject({ language: "xx" });
    s.stop();
  } finally {
    await h.close();
  }
});
test("TC-j30-06 TC-I18N-33 registered choices survive restart and unknown choices are refused", async () => {
  const h = await createServiceHarness(tmpdir());
  try {
    for (const language of ["fr", "id-ID"])
      await expect(h.call("settings.update", { patch: { language } })).rejects.toMatchObject({
        code: "invalid_input",
        reason: "language_unknown",
      });
    await h.call("settings.update", { patch: { language: "id" } });
    expect(h.store.listAudit().filter((x) => x.kind === "setting_changed")).toMatchObject([
      { detail: { key: "language", from: "en", to: "id" } },
    ]);
    h.service.stop();
    const s = createRunnerService({ store: h.store, dataDir: h.dataDir, mode: "demo", languages: codes });
    expect(await s.call("settings.get", {})).toMatchObject({ language: "id" });
    h.store.putSetting("language", "fr");
    expect(await s.call("settings.get", {})).toMatchObject({ language: "en" });
    s.stop();
    const defaultService = createRunnerService({ store: h.store, dataDir: h.dataDir, mode: "demo" });
    await expect(defaultService.call("settings.update", { patch: { language: "id" } })).rejects.toMatchObject(
      { code: "invalid_input", reason: "language_unknown" },
    );
    defaultService.stop();
  } finally {
    await h.close();
  }
});
test("TC-AGT-30 notices use the registered stored language", async () => {
  const h = await createServiceHarness(tmpdir());
  try {
    const send = vi.fn();
    const notifier = createNotifier({ store: h.store, now: h.clock.now, send, languages: codes });
    await h.call("settings.update", { patch: { language: "id" } });
    notifier.onFlood({ flowId: "example.flow", flowName: "Flow", day: "2026-11-19", cap: 24 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ language: "id" }));
    h.store.putSetting("language", "xx");
    notifier.onPaused({
      flowId: "example.flow",
      flowName: "Flow",
      index: 0,
      pausedAt: "2026-11-19T10:00:00.000Z",
    });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ language: "en" }));
  } finally {
    await h.close();
  }
});
test("TC-j30-07 TC-j30-35 language updates do not create runs, decisions or notices", async () => {
  const h = await createServiceHarness(tmpdir());
  try {
    const { approvedDecision } = await import("../test-helpers/builders.ts");
    const decision = approvedDecision(h.store, { id: "sample", createdAt: "2026-11-19T10:00:00.000Z" });
    h.store.updateRun(decision.runId, { state: "running" });
    h.store.addUsage({
      at: "2026-11-19T10:00:00.000Z",
      runId: decision.runId,
      stepId: decision.stepId,
      itemKey: "",
      attempt: 1,
      kind: "worker",
      harness: "test",
      models: [],
      turns: 1,
      wallMs: 1,
      queuedMs: 0,
      exit: "ok",
      costUsd: 10,
      billing: "per_use",
    });
    const snapshot = () => ({
      chats: h.store.listChats(),
      messages: h.store.listMessages("chat-sample"),
      flows: h.store.listFlows(),
      runs: h.store.listRuns({}),
      approvals: h.store.listApprovals({}),
      usage: h.store.listUsage(),
    });
    const before = snapshot();
    const audit = h.store.listAudit().length;
    for (const language of ["id", "en"]) await h.call("settings.update", { patch: { language } });
    expect(snapshot()).toEqual(before);
    expect(h.store.getRun(decision.runId)).toMatchObject({ state: "running", id: decision.runId });
    expect(
      h.store
        .listAudit()
        .slice(audit)
        .map((x) => x.kind),
    ).toEqual(["setting_changed", "setting_changed"]);
  } finally {
    await h.close();
  }
});

test("TC-j30-36 language changes keep the confirmed flow and schedule", async () => {
  const h = await createServiceHarness(tmpdir());
  try {
    const { seedSampleFlow } = await import("../test-helpers/builders.ts");
    const { manifest, hash } = seedSampleFlow(h.store, "example.fill-timesheet");
    const at = "2026-11-19T10:00:00.000Z";
    h.store.putSchedule({
      flowId: manifest.id,
      type: "weekly",
      day: "mon",
      time: "17:00",
      whenItsTime: "ask",
      setAt: at,
      setBy: "window",
      confirmedHash: hash,
    });
    const before = await h.call("flows.get", { flowId: manifest.id });
    const schedule = h.store.getSchedule(manifest.id);
    for (const language of ["id", "en"]) {
      await h.call("settings.update", { patch: { language } });
      expect(await h.call("flows.get", { flowId: manifest.id })).toEqual(before);
      expect(h.store.getSchedule(manifest.id)).toEqual(schedule);
    }
    expect(before).toMatchObject({ summary: { state: "confirmed" }, hash });
  } finally {
    await h.close();
  }
});
