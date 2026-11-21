import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { EngineError } from "./errors.ts";
import {
  CAPABILITY_SCHEMA,
  HARNESS_STATE_SCHEMA,
  PINS_SCHEMA,
  SCHEMA,
  TRIGGER_SCHEMA,
  USAGE_SCHEMA,
} from "./schema.ts";
import type {
  ApprovalRow,
  AuditEntry,
  ConsentPins,
  FlowRow,
  HarnessStateRow,
  ItemRow,
  RunRow,
  StepRow,
  Store,
  TriggerRow,
  UsageEventRow,
} from "./storage.ts";

export async function openSqliteStore(
  path: string,
  options?: { now?: () => Date; exclusive?: boolean },
): Promise<Store> {
  const { DatabaseSync } = await import("node:sqlite");
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    if (options?.exclusive && path !== ":memory:")
      throw new EngineError(
        "unavailable",
        error instanceof Error && /locked|busy/i.test(error.message)
          ? "Another FlowDriven runner is using this data folder."
          : "The data folder could not be opened.",
      );
    throw error;
  }
  try {
    if (options?.exclusive && path !== ":memory:") {
      try {
        db.exec(
          "PRAGMA busy_timeout = 250; PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL; BEGIN IMMEDIATE; COMMIT;",
        );
      } catch (error) {
        throw new EngineError(
          "unavailable",
          error instanceof Error && /locked|busy/i.test(error.message)
            ? "Another FlowDriven runner is using this data folder."
            : "The data folder could not be opened.",
        );
      }
    }
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof version !== "number" || version > 6 || version < 0)
      throw new EngineError("unavailable", "Unsupported database version.");
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    if (version === 0)
      db.exec(
        `BEGIN; ${SCHEMA} ${HARNESS_STATE_SCHEMA} ${USAGE_SCHEMA} ${TRIGGER_SCHEMA} ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6; COMMIT;`,
      );
    if (version === 1)
      db.exec(
        `BEGIN; ${HARNESS_STATE_SCHEMA} ${USAGE_SCHEMA} ${TRIGGER_SCHEMA} ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6; COMMIT;`,
      );
    if (version === 2)
      db.exec(
        `BEGIN; ${USAGE_SCHEMA} ${TRIGGER_SCHEMA} ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6; COMMIT;`,
      );
    if (version === 3)
      db.exec(
        `BEGIN; ${TRIGGER_SCHEMA} ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6; COMMIT;`,
      );
    if (version === 4) db.exec(`BEGIN; ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6; COMMIT;`);
    if (version === 5) db.exec(`BEGIN; ${PINS_SCHEMA} PRAGMA user_version = 6; COMMIT;`);
  } catch (error) {
    db.close();
    throw error;
  }
  const get = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args);
  const all = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args);
  const execute = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args);
  const decode = <T>(row: Record<string, unknown> | undefined): T | undefined =>
    row ? (JSON.parse(String(row.data)) as T) : undefined;
  const decodeAll = <T>(rows: Record<string, unknown>[]): T[] =>
    rows.map((row) => JSON.parse(String(row.data)) as T);
  const decodeTrigger = (record: Record<string, unknown> | undefined): TriggerRow | undefined => {
    if (!record) return undefined;
    try {
      const value: unknown = JSON.parse(String(record.data));
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const r = value as Record<string, unknown>;
      if (
        typeof r.flowId !== "string" ||
        r.flowId !== record.flow_id ||
        typeof r.index !== "number" ||
        !Number.isSafeInteger(r.index) ||
        r.index < 0 ||
        r.index !== record.idx ||
        typeof r.enabled !== "boolean" ||
        typeof r.hash !== "string" ||
        typeof r.spec !== "string" ||
        typeof r.enabledAt !== "string" ||
        (r.cursorMs !== undefined && (typeof r.cursorMs !== "number" || !Number.isFinite(r.cursorMs))) ||
        (r.recentRuns !== undefined &&
          (!Array.isArray(r.recentRuns) ||
            r.recentRuns.length > 3 ||
            !r.recentRuns.every((v: unknown) => typeof v === "string"))) ||
        (r.pausedAt !== undefined &&
          (typeof r.pausedAt !== "string" || !Number.isFinite(Date.parse(r.pausedAt))))
      )
        return undefined;
      if (r.lastFire !== undefined) {
        if (!r.lastFire || typeof r.lastFire !== "object" || Array.isArray(r.lastFire)) return undefined;
        const f = r.lastFire as Record<string, unknown>;
        if (
          typeof f.at !== "string" ||
          typeof f.outcome !== "string" ||
          ![
            "started",
            "skipped_overlap",
            "dropped_cap",
            "dropped_queue_full",
            "duplicate",
            "needs_ok",
            "refused",
            "missed",
            "depth",
            "error",
          ].includes(f.outcome) ||
          (f.runId !== undefined && typeof f.runId !== "string") ||
          (f.detail !== undefined && typeof f.detail !== "string")
        )
          return undefined;
      }
      return r as TriggerRow;
    } catch {
      return undefined;
    }
  };
  const json = (value: unknown): string => {
    const result = JSON.stringify(value);
    if (result === undefined) throw new EngineError("invalid_input", "Value is not JSON serializable.");
    return result;
  };
  let depth = 0;
  const store: Store = {
    schemaVersion: () => Number(db.prepare("PRAGMA user_version").get()?.user_version),
    getCapabilityConsent(flowId) {
      const row = get("SELECT flow_id, hash, at FROM capability_consents WHERE flow_id = ?", flowId);
      if (
        !row ||
        typeof row.flow_id !== "string" ||
        row.flow_id !== flowId ||
        typeof row.hash !== "string" ||
        typeof row.at !== "string"
      )
        return undefined;
      try {
        const hash: unknown = JSON.parse(row.hash);
        const at: unknown = JSON.parse(row.at);
        if (typeof hash !== "string" || typeof at !== "string") return undefined;
        const consent = { flowId, hash, at };
        const pinRow = get("SELECT pins FROM consent_pins WHERE flow_id = ?", flowId);
        if (typeof pinRow?.pins !== "string") return consent;
        try {
          const value: unknown = JSON.parse(pinRow.pins);
          const isRecord = (v: unknown): v is Record<string, unknown> =>
            v !== null && typeof v === "object" && !Array.isArray(v);
          if (!isRecord(value) || !isRecord(value.skills) || !isRecord(value.folders)) return consent;
          if (!Object.values(value.skills).every((v) => typeof v === "string")) return consent;
          if (
            !Object.values(value.folders).every(
              (v) =>
                isRecord(v) &&
                typeof v.path === "string" &&
                (v.access === "read" || v.access === "read_write"),
            )
          )
            return consent;
          return { ...consent, pins: value as ConsentPins };
        } catch {
          return consent;
        }
      } catch {
        return undefined;
      }
    },
    putCapabilityConsent(row) {
      store.transaction(() => {
        execute(
          "INSERT OR REPLACE INTO capability_consents (flow_id, hash, at) VALUES (?, ?, ?)",
          row.flowId,
          json(row.hash),
          json(row.at),
        );
        if (row.pins === undefined) execute("DELETE FROM consent_pins WHERE flow_id = ?", row.flowId);
        else
          execute(
            "INSERT OR REPLACE INTO consent_pins (flow_id, pins) VALUES (?, ?)",
            row.flowId,
            json(row.pins),
          );
      });
    },
    deleteCapabilityConsent(flowId) {
      store.transaction(() => {
        execute("DELETE FROM consent_pins WHERE flow_id = ?", flowId);
        execute("DELETE FROM capability_consents WHERE flow_id = ?", flowId);
      });
    },
    getTrigger(flowId, index) {
      return decodeTrigger(
        get("SELECT flow_id, idx, data FROM triggers WHERE flow_id = ? AND idx = ?", flowId, index),
      );
    },
    putTrigger(row) {
      execute(
        "INSERT OR REPLACE INTO triggers (flow_id, idx, data) VALUES (?, ?, ?)",
        row.flowId,
        row.index,
        json(row),
      );
    },
    listTriggers(flowId) {
      return all(
        "SELECT flow_id, idx, data FROM triggers WHERE (? IS NULL OR flow_id = ?) ORDER BY flow_id, idx",
        flowId ?? null,
        flowId ?? null,
      )
        .map(decodeTrigger)
        .filter((row): row is TriggerRow => row !== undefined);
    },
    claimKey(flowId, index, key, at) {
      return (
        Number(
          execute("INSERT OR IGNORE INTO fire_keys VALUES (?, ?, ?, ?)", flowId, index, key, at).changes,
        ) === 1
      );
    },
    purgeKeys(before) {
      return Number(execute("DELETE FROM fire_keys WHERE at < ?", before).changes);
    },
    addUsage(row) {
      execute(
        "INSERT INTO usage_events (at, run_id, step_id, item_key, attempt, kind, harness, models, turns, wall_ms, queued_ms, memory_peak_mb, exit, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        row.at,
        row.runId,
        row.stepId,
        row.itemKey,
        row.attempt,
        row.kind,
        row.harness,
        json(row.models),
        row.turns,
        row.wallMs,
        row.queuedMs,
        row.memoryPeakMb ?? null,
        row.exit,
        row.costUsd ?? null,
      );
    },
    listUsage(filter) {
      return all(
        "SELECT * FROM usage_events WHERE (? IS NULL OR run_id = ?) AND (? IS NULL OR at >= ?) ORDER BY id",
        filter?.runId ?? null,
        filter?.runId ?? null,
        filter?.since ?? null,
        filter?.since ?? null,
      ).map((row) => ({
        at: String(row.at),
        runId: String(row.run_id),
        stepId: String(row.step_id),
        itemKey: String(row.item_key),
        attempt: Number(row.attempt),
        kind: row.kind as UsageEventRow["kind"],
        harness: String(row.harness),
        models: JSON.parse(String(row.models)) as UsageEventRow["models"],
        turns: Number(row.turns),
        wallMs: Number(row.wall_ms),
        queuedMs: Number(row.queued_ms),
        ...(row.memory_peak_mb === null ? {} : { memoryPeakMb: Number(row.memory_peak_mb) }),
        exit: row.exit as UsageEventRow["exit"],
        ...(row.cost_usd === null ? {} : { costUsd: Number(row.cost_usd) }),
      }));
    },
    recentPeaks(q) {
      if (!Number.isSafeInteger(q.runs) || q.runs < 0)
        throw new EngineError("invalid_input", "Run count must be a non-negative integer.");
      return all(
        "SELECT MAX(u.memory_peak_mb) AS peak FROM usage_events u JOIN runs r ON r.id = u.run_id WHERE r.flow_id = ? AND u.step_id = ? AND u.kind = ? AND u.harness = ? AND u.memory_peak_mb IS NOT NULL GROUP BY u.run_id ORDER BY MIN(u.id) DESC LIMIT ?",
        q.flowId,
        q.stepId,
        q.kind,
        q.harness,
        q.runs,
      ).map((row) => Number(row.peak));
    },
    getSetting(name) {
      return decode(get("SELECT data FROM settings WHERE name = ?", name));
    },
    deleteSetting(name) {
      execute("DELETE FROM settings WHERE name = ?", name);
    },
    putSetting(name, value) {
      execute("INSERT OR REPLACE INTO settings (name, data) VALUES (?, ?)", name, json(value));
    },
    getHarnessState(id) {
      return decode<HarnessStateRow>(get("SELECT data FROM harness_state WHERE id = ?", id));
    },
    putHarnessState(row) {
      let data: string;
      try {
        data = json(row);
      } catch {
        throw new EngineError("invalid_input", "Value is not JSON serializable.");
      }
      execute("INSERT OR REPLACE INTO harness_state (id, data) VALUES (?, ?)", row.id, data);
    },
    transaction<T>(fn: () => T): T {
      const level = depth;
      const savepoint = `store_${level}`;
      db.exec(level === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
      depth++;
      try {
        const result = fn();
        db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw error;
      } finally {
        depth--;
      }
    },
    putFlow(row) {
      execute("INSERT OR REPLACE INTO flows (id, hash, data) VALUES (?, ?, ?)", row.id, row.hash, json(row));
    },
    getFlow(id, hash) {
      return decode<FlowRow>(
        hash === undefined
          ? get("SELECT data FROM flows WHERE id = ? ORDER BY rowid DESC LIMIT 1", id)
          : get("SELECT data FROM flows WHERE id = ? AND hash = ?", id, hash),
      );
    },
    listFlows() {
      return decodeAll<FlowRow>(
        all("SELECT data FROM flows WHERE rowid IN (SELECT MAX(rowid) FROM flows GROUP BY id) ORDER BY id"),
      );
    },
    createRun(row) {
      execute("INSERT INTO runs VALUES (?, ?, ?, ?)", row.id, row.flowId, row.state, json(row));
    },
    updateRun(id, patch) {
      const row = store.getRun(id);
      if (!row) throw new EngineError("not_found", "Run not found.");
      const next = { ...row, ...patch };
      execute(
        "UPDATE runs SET flow_id = ?, state = ?, data = ? WHERE id = ?",
        next.flowId,
        next.state,
        json(next),
        id,
      );
    },
    getRun(id) {
      return decode<RunRow>(get("SELECT data FROM runs WHERE id = ?", id));
    },
    listRuns(filter) {
      return decodeAll<RunRow>(
        all(
          "SELECT data FROM runs WHERE (? IS NULL OR flow_id = ?) AND (? IS NULL OR state = ?) ORDER BY rowid",
          filter?.flowId ?? null,
          filter?.flowId ?? null,
          filter?.state ?? null,
          filter?.state ?? null,
        ),
      );
    },
    upsertStep(row) {
      execute(
        "INSERT INTO steps VALUES (?, ?, ?, ?) ON CONFLICT(run_id, step_id, item_key) DO UPDATE SET data = excluded.data",
        row.runId,
        row.stepId,
        row.itemKey,
        json(row),
      );
    },
    getStep(runId, stepId, itemKey = "") {
      return decode<StepRow>(
        get(
          "SELECT data FROM steps WHERE run_id = ? AND step_id = ? AND item_key = ?",
          runId,
          stepId,
          itemKey,
        ),
      );
    },
    listSteps(runId) {
      return decodeAll<StepRow>(all("SELECT data FROM steps WHERE run_id = ? ORDER BY rowid", runId));
    },
    upsertItem(row) {
      execute(
        "INSERT INTO items VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, loop_id, position) DO UPDATE SET key = excluded.key, data = excluded.data",
        row.runId,
        row.loopId,
        row.key,
        row.position,
        json(row),
      );
    },
    listItems(runId, loopId) {
      return decodeAll<ItemRow>(
        all(
          "SELECT data FROM items WHERE run_id = ? AND (? IS NULL OR loop_id = ?) ORDER BY position, rowid",
          runId,
          loopId ?? null,
          loopId ?? null,
        ),
      );
    },
    isSeen(flowId, loopId, key) {
      return (
        get("SELECT 1 FROM seen WHERE flow_id = ? AND loop_id = ? AND key = ?", flowId, loopId, key) !==
        undefined
      );
    },
    markSeen(flowId, loopId, key, at) {
      execute(
        "INSERT INTO seen VALUES (?, ?, ?, ?) ON CONFLICT(flow_id, loop_id, key) DO UPDATE SET at = excluded.at",
        flowId,
        loopId,
        key,
        at,
      );
    },
    purgeSeen(before) {
      return Number(execute("DELETE FROM seen WHERE at < ?", before).changes);
    },
    createApproval(row) {
      execute("INSERT INTO approvals VALUES (?, ?, ?, ?)", row.id, row.runId, row.state, json(row));
    },
    getApproval(id) {
      return decode<ApprovalRow>(get("SELECT data FROM approvals WHERE id = ?", id));
    },
    listApprovals(filter) {
      return decodeAll<ApprovalRow>(
        all(
          "SELECT data FROM approvals WHERE (? IS NULL OR state = ?) AND (? IS NULL OR run_id = ?) ORDER BY rowid",
          filter?.state ?? null,
          filter?.state ?? null,
          filter?.runId ?? null,
          filter?.runId ?? null,
        ),
      );
    },
    updateApproval(id, patch) {
      const row = store.getApproval(id);
      if (!row) throw new EngineError("not_found", "Approval not found.");
      const next = { ...row, ...patch };
      execute(
        "UPDATE approvals SET run_id = ?, state = ?, data = ? WHERE id = ?",
        next.runId,
        next.state,
        json(next),
        id,
      );
    },
    addGrant(runId, tool, itemKey) {
      execute("INSERT OR IGNORE INTO grants VALUES (?, ?, ?)", runId, tool, itemKey);
    },
    hasGrant(runId, tool, itemKey) {
      return (
        get("SELECT 1 FROM grants WHERE run_id = ? AND tool = ? AND item_key = ?", runId, tool, itemKey) !==
        undefined
      );
    },
    increment(name, day, by = 1) {
      if (!Number.isSafeInteger(by))
        throw new EngineError("invalid_input", "Counter increment must be an integer.");
      execute(
        "INSERT INTO counters VALUES (?, ?, ?) ON CONFLICT(name, day) DO UPDATE SET value = value + excluded.value",
        name,
        day,
        by,
      );
      return store.counter(name, day);
    },
    counter(name, day) {
      const value = get("SELECT value FROM counters WHERE name = ? AND day = ?", name, day)?.value;
      return value === undefined ? 0 : Number(value);
    },
    appendAudit(entry) {
      execute(
        "INSERT INTO audit_log (at, kind, run_id, detail) VALUES (?, ?, ?, ?)",
        entry.at,
        entry.kind,
        entry.runId ?? null,
        json(entry.detail),
      );
    },
    listAudit(runId) {
      return all(
        "SELECT at, kind, run_id, detail FROM audit_log WHERE (? IS NULL OR run_id = ?) ORDER BY id",
        runId ?? null,
        runId ?? null,
      ).map((row) => ({
        at: String(row.at),
        kind: String(row.kind),
        ...(row.run_id === null ? {} : { runId: String(row.run_id) }),
        detail: JSON.parse(String(row.detail)) as AuditEntry["detail"],
      }));
    },
    close() {
      db.close();
    },
  };
  return store;
}
