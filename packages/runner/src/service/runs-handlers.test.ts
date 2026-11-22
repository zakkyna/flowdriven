import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { createRunnerService } from "./service.ts";

test("TC-ENG-23 audit.list returns ordered structured records and remains append-only", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    store.createRun({
      id: "run-1",
      flowId: "flow",
      flowHash: "hash",
      flowVersion: "1",
      state: "done",
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-19T10:00:00.000Z",
    });
    for (const [kind, runId] of [
      ["start", "run-1"],
      ["other", "run-2"],
      ["held", "run-1"],
      ["approved", "run-1"],
      ["end", "run-1"],
    ] as const) {
      store.appendAudit({
        at: "2026-11-19T10:00:00.000Z",
        kind,
        runId,
        detail: { kind, count: 1, ok: true, missing: null, ids: ["a"] },
      });
    }
    const rows = await service.call("audit.list", { runId: "run-1" });
    expect(rows).toEqual(
      [1, 3, 4, 5].map((id, index) => ({
        id,
        at: "2026-11-19T10:00:00.000Z",
        kind: ["start", "held", "approved", "end"][index],
        runId: "run-1",
        detail: {
          kind: ["start", "held", "approved", "end"][index],
          count: 1,
          ok: true,
          missing: null,
          ids: ["a"],
        },
      })),
    );
    expect(await service.call("audit.list", { afterId: 2, limit: 2 })).toEqual(
      (rows as unknown[]).slice(1, 3),
    );
    store.appendAudit({
      at: "2026-11-19T10:00:00.000Z",
      kind: "run_error",
      runId: "run-1",
      detail: { message: "private message", code: "internal_error", settings: { count: 2 } },
    });
    expect(await service.call("audit.list", { afterId: 5 })).toEqual([
      {
        id: 6,
        at: "2026-11-19T10:00:00.000Z",
        kind: "run_error",
        runId: "run-1",
        detail: { code: "internal_error", "settings.count": 2 },
      },
    ]);
    const db = new DatabaseSync(path);
    try {
      expect(() => db.exec("UPDATE audit_log SET kind = 'changed'")).toThrow();
      expect(() => db.exec("DELETE FROM audit_log")).toThrow();
    } finally {
      db.close();
    }
  } finally {
    service.stop();
    store.close();
    cleanup();
  }
});

test("TC-ENG-22 runs.list filters and pages", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const { demoFlow } = await import("../demo/demo-flow.ts");
    const { manifest, files } = demoFlow();
    const hash = `sha256:${"a".repeat(64)}`;
    store.putFlow({
      id: manifest.id,
      hash,
      version: manifest.version,
      manifest,
      files,
      registeredAt: "2026-11-19T00:00:00.000Z",
    });
    store.putFlow({
      id: "other",
      hash,
      version: manifest.version,
      manifest,
      files,
      registeredAt: "2026-11-19T00:00:00.000Z",
    });
    for (let i = 0; i < 8; i++)
      store.createRun({
        id: `run-${i}`,
        flowId: i < 5 ? manifest.id : "other",
        flowHash: hash,
        flowVersion: manifest.version,
        flowName: i < 5 ? manifest.name : "Other",
        state: i < 2 ? "stopped" : "done",
        project: ".",
        inputs: {},
        params: {},
        requirements: [],
        start: { source: (["flows", "schedule", "chat", "again"] as const)[i % 4] ?? "flows" },
        agent: { agent: "claude-code", choice: "main" },
        startedAt: `2026-11-19T10:0${i}:00.000Z`,
        ...(i === 5 ? { endedAt: "2026-11-19T10:05:30.000Z" } : {}),
      });
    const all = (await service.call("runs.list", {})) as Array<Record<string, unknown>>;
    expect(all.map((r) => r.id)).toEqual([
      "run-7",
      "run-6",
      "run-5",
      "run-4",
      "run-3",
      "run-2",
      "run-1",
      "run-0",
    ]);
    expect(
      ((await service.call("runs.list", { source: "schedule" })) as Array<{ id: string }>).map((r) => r.id),
    ).toEqual(["run-5", "run-1"]);
    expect(
      all.every(
        (r) =>
          typeof r.flowName === "string" &&
          typeof r.source === "string" &&
          typeof r.agent === "string" &&
          typeof r.versionChanged === "boolean",
      ),
    ).toBe(true);
    expect(
      ((await service.call("runs.list", { flowId: manifest.id })) as Array<{ id: string }>).map((r) => r.id),
    ).toEqual(["run-4", "run-3", "run-2", "run-1", "run-0"]);
    expect(
      ((await service.call("runs.list", { state: "stopped" })) as Array<{ id: string }>).map((r) => r.id),
    ).toEqual(["run-1", "run-0"]);
    const first = (await service.call("runs.list", { limit: 3 })) as Array<Record<string, unknown>>;
    const second = (await service.call("runs.list", {
      limit: 3,
      before: first[2]?.endedAt ?? first[2]?.startedAt,
    })) as Array<Record<string, unknown>>;
    expect(first.map((r) => r.id)).toEqual(["run-7", "run-6", "run-5"]);
    expect(second.map((r) => r.id)).toEqual(["run-4", "run-3", "run-2"]);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RES-09 runs.status shows billing, flow availability and retry", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const { demoFlow } = await import("../demo/demo-flow.ts");
    const { manifest, files } = demoFlow();
    const hash = `sha256:${"a".repeat(64)}`;
    store.putFlow({
      id: manifest.id,
      hash,
      version: manifest.version,
      manifest,
      files,
      registeredAt: "2026-11-19T00:00:00.000Z",
    });
    for (let i = 0; i < 6; i++) {
      store.createRun({
        id: `run-${i}`,
        flowId: manifest.id,
        flowHash: hash,
        flowVersion: manifest.version,
        flowName: "Original name",
        state: i === 5 ? "blocked" : "done",
        project: ".",
        inputs: {},
        params: {},
        requirements: [],
        startedAt: "2026-11-19T10:00:00.000Z",
        ...(i === 5
          ? { blockedReason: "Missing requirement", cause: { code: "requirement_missing" as const } }
          : {}),
      });
      if (i < 3)
        store.addUsage({
          at: "2026-11-19T10:00:00.000Z",
          runId: `run-${i}`,
          stepId: "step",
          itemKey: "",
          attempt: 1,
          kind: "worker",
          harness: "claude-code",
          models: [],
          turns: 1,
          wallMs: 0,
          queuedMs: 0,
          exit: "ok",
          ...(i === 0
            ? { billing: "plan" as const }
            : i === 1
              ? { billing: "per_use" as const, costUsd: 0.42 }
              : { costUsd: 0 }),
        });
    }
    const status = async (id: number) =>
      (await service.call("runs.status", { runId: `run-${id}` })) as Record<string, unknown>;
    expect((await status(0)).costLine).toEqual({ kind: "plan" });
    expect((await status(1)).costLine).toEqual({ kind: "amount", usd: 0.42 });
    expect((await status(2)).costLine).toEqual({ kind: "none" });
    expect((await status(3)).costLine).toEqual({ kind: "none" });
    expect((await status(2)).canTryAgain).toBe(false);
    expect((await status(5)).canTryAgain).toBe(true);
    store.updateRun("run-5", { state: "needs_login" });
    expect((await status(5)).canTryAgain).toBe(true);
    store.updateRun("run-5", { state: "interrupted" });
    expect((await status(5)).canTryAgain).toBe(true);
    store.updateRun("run-2", { decisionLines: [{ key: "report.youSaidNo", params: { title: "Send" } }] });
    expect(await service.call("runs.report", { runId: "run-2" })).toMatchObject({
      decisionLines: [{ key: "report.youSaidNo", params: { title: "Send" } }],
      result: { kind: "report" },
    });
    store.putFlowHead({
      id: manifest.id,
      name: manifest.name,
      summary: "",
      createdAt: "2026-11-19T00:00:00.000Z",
      origin: { kind: "demo" },
      headHash: hash,
      updatedAt: "2026-11-19T10:00:00.000Z",
      deletedAt: "2026-11-19T11:00:00.000Z",
    });
    expect(await status(3)).toMatchObject({ flowName: "Original name", canRunAgain: false });
    store.putFlowHead({
      id: manifest.id,
      name: manifest.name,
      summary: "",
      createdAt: "2026-11-19T00:00:00.000Z",
      origin: { kind: "demo" },
      headHash: `sha256:${"b".repeat(64)}`,
      updatedAt: "2026-11-19T10:00:00.000Z",
    });
    expect((await status(4)).versionChanged).toBe(true);
  } finally {
    service.stop();
    store.close();
  }
});
