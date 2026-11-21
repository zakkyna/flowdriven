import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EngineError } from "./errors.ts";
import {
  CAPABILITY_SCHEMA,
  HARNESS_STATE_SCHEMA,
  PINS_SCHEMA,
  SCHEMA,
  SCHEMA_V7,
  TRIGGER_SCHEMA,
  USAGE_SCHEMA,
} from "./schema.ts";

export type MigrationStep =
  | "backup_mkdir"
  | "backup_vacuum"
  | "backup_integrity"
  | "create_tables"
  | "add_billing_column"
  | "create_indexes"
  | "fill_flow_heads"
  | "fill_confirmations"
  | "fill_call_grants"
  | "write_audit"
  | "set_version";
export type MigrationOptions = { now?: () => Date; failAt?: MigrationStep | ((step: MigrationStep) => void) };
function step(options: MigrationOptions | undefined, name: MigrationStep) {
  if (typeof options?.failAt === "function") options.failAt(name);
  else if (options?.failAt === name) throw new Error(`Injected failure: ${name}`);
}
export function migrate(db: DatabaseSync, path: string, options?: MigrationOptions): void {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (typeof version !== "number" || version > 7 || version < 0)
    throw new EngineError("unavailable", "Unsupported database version.", "store_newer");
  if (version === 7) return;
  const empty =
    version === 0 &&
    db
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .get()?.count === 0;
  if (!empty && path !== ":memory:") {
    try {
      step(options, "backup_mkdir");
      const folder = join(dirname(path), "backups");
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      chmodSync(folder, 0o700);
      const time = (options?.now?.() ?? new Date())
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
      const target = join(folder, `flowdriven-v${version}-${time}.sqlite`);
      if (existsSync(target)) throw new Error("Backup already exists.");
      step(options, "backup_vacuum");
      db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
      chmodSync(target, 0o600);
      step(options, "backup_integrity");
      const copy = new DatabaseSync(target, { readOnly: true });
      try {
        if (
          copy.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
          copy.prepare("PRAGMA user_version").get()?.user_version !== version
        )
          throw new Error("Invalid backup.");
      } finally {
        copy.close();
      }
    } catch {
      throw new EngineError(
        "unavailable",
        "FlowDriven could not back up its data, so it changed nothing.",
        "backup_failed",
      );
    }
  }
  try {
    db.exec("BEGIN IMMEDIATE");
    if (version === 0) db.exec(SCHEMA);
    if (version <= 1) db.exec(HARNESS_STATE_SCHEMA);
    if (version <= 2) db.exec(USAGE_SCHEMA);
    if (version <= 3) db.exec(TRIGGER_SCHEMA);
    if (version <= 4) db.exec(CAPABILITY_SCHEMA);
    if (version <= 5) db.exec(PINS_SCHEMA);
    const [tables, rest] = SCHEMA_V7.split("ALTER TABLE usage_events ADD COLUMN billing TEXT;");
    if (tables === undefined || rest === undefined) throw new Error("Invalid schema.");
    step(options, "create_tables");
    db.exec(tables);
    step(options, "add_billing_column");
    db.exec("ALTER TABLE usage_events ADD COLUMN billing TEXT;");
    step(options, "create_indexes");
    db.exec(rest);
    for (const label of [
      "fill_flow_heads",
      "fill_confirmations",
      "fill_call_grants",
      "write_audit",
      "set_version",
    ] as const)
      step(options, label);
    db.exec("PRAGMA user_version = 7; COMMIT;");
  } catch {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw new EngineError(
      "unavailable",
      "FlowDriven could not update its data. Nothing was changed, and a copy is in the backups folder.",
      "migration_failed",
    );
  }
}
