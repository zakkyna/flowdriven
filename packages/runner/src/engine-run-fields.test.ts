import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { openSqliteStore } from "./sqlite-store.ts";
import type { RunRow } from "./storage.ts";
import { makeStoreV6 } from "./test-helpers/store-v6.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

test("TC-ENG-19 a run records its agent, language and start and old runs get defaults", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    store.putFlow({
      id: "f",
      hash: "H1",
      version: "1",
      manifest: { name: "Build APK and upload it" },
      files: {},
      registeredAt: "2026",
    });
    const base: RunRow = {
      id: "run",
      flowId: "f",
      flowHash: "H1",
      flowVersion: "1",
      state: "done",
      project: "p",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026",
    };
    const modern = {
      ...base,
      agent: { agent: "claude-code", model: "opus-5.5", choice: "chat" },
      language: "id",
      flowName: "Build APK and upload it",
      start: { source: "chat", chatId: "chat", messageId: "message" },
    } as const;
    store.createRun(modern);
    expect(store.getRun("run")).toMatchObject(modern);
    for (const [id, trigger, state, source] of [
      ["manual", undefined, "done", "flows"],
      ["after", "flow_done", "done", "after"],
      ["schedule", "schedule", "done", "schedule"],
      ["crash", undefined, "interrupted", "flows"],
    ] as const) {
      store.createRun({ ...base, id, state, ...(trigger ? { trigger: { kind: trigger } } : {}) });
      expect(store.getRun(id)).toMatchObject({
        agent: { agent: "claude-code", choice: "main" },
        language: "en",
        flowName: "Build APK and upload it",
        start: { source },
        decisionLines: [],
        ...(state === "interrupted" ? { cause: { code: "crash" } } : {}),
      });
    }
  } finally {
    store.close();
  }
  const path = makeStoreV6(dirname(tempPath()));
  const old = new DatabaseSync(path);
  old.exec(
    "UPDATE runs SET data = json_set(data, '$.trigger', json('{\"kind\":\"flow_done\"}')) WHERE id = 'done'; UPDATE runs SET data = json_set(data, '$.trigger', json('{\"kind\":\"schedule\"}')) WHERE id = 'failed'",
  );
  old.close();
  const migrated = await openSqliteStore(path);
  const db = new DatabaseSync(path);
  try {
    const before = db.prepare("SELECT id, data FROM runs ORDER BY id").all();
    expect(migrated.getRun("queued")).toMatchObject({
      agent: { agent: "claude-code", choice: "main" },
      language: "en",
      start: { source: "flows" },
    });
    expect(migrated.getRun("done")?.start?.source).toBe("after");
    expect(migrated.getRun("failed")?.start?.source).toBe("schedule");
    expect(migrated.getRun("interrupted")?.cause).toEqual({ code: "crash" });
    expect(db.prepare("SELECT id, data FROM runs ORDER BY id").all()).toEqual(before);
  } finally {
    db.close();
    migrated.close();
    cleanup();
  }
});
