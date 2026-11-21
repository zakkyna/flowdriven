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
