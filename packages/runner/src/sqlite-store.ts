import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { EngineError } from "./errors.ts";
import { HARNESS_STATE_SCHEMA, SCHEMA } from "./schema.ts";
import type {
  ApprovalRow,
  AuditEntry,
  FlowRow,
  HarnessStateRow,
  ItemRow,
  RunRow,
  StepRow,
  Store,
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
    if (typeof version !== "number" || version > 2 || version < 0)
      throw new EngineError("unavailable", "Unsupported database version.");
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    if (version === 0) db.exec(`BEGIN; ${SCHEMA} ${HARNESS_STATE_SCHEMA} PRAGMA user_version = 2; COMMIT;`);
    if (version === 1) db.exec(`BEGIN; ${HARNESS_STATE_SCHEMA} PRAGMA user_version = 2; COMMIT;`);
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
  const json = (value: unknown): string => {
    const result = JSON.stringify(value);
    if (result === undefined) throw new EngineError("invalid_input", "Value is not JSON serializable.");
    return result;
  };
  let depth = 0;
  const store: Store = {
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
