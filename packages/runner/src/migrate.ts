import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  let backup: string | null = null;
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
      backup = basename(target);
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
    step(options, "fill_flow_heads");
    const renames: { flowId: string; from: string; to: string }[] = [];
    const names = new Set<string>();
    const flows = db
      .prepare(
        "SELECT id, hash, data FROM flows WHERE rowid IN (SELECT MAX(rowid) FROM flows GROUP BY id) ORDER BY (SELECT MIN(f.rowid) FROM flows f WHERE f.id = flows.id)",
      )
      .all();
    const insertHead = db.prepare("INSERT INTO flow_heads (id, name, summary, data) VALUES (?, ?, ?, ?)");
    for (const row of flows) {
      const flow = JSON.parse(String(row.data)) as {
        manifest: { name: string; summary: string };
        registeredAt: string;
      };
      const id = String(row.id);
      const name = flow.manifest.name;
      let unique = name;
      let suffix = 2;
      while (names.has(unique.replace(/[A-Z]/g, (c) => c.toLowerCase()))) unique = `${name} ${suffix++}`;
      names.add(unique.replace(/[A-Z]/g, (c) => c.toLowerCase()));
      if (unique !== name) renames.push({ flowId: id, from: name, to: unique });
      const versions = db.prepare("SELECT data FROM flows WHERE id = ? ORDER BY rowid").all(id);
      const createdAt = versions
        .map((v) => (JSON.parse(String(v.data)) as { registeredAt: string }).registeredAt)
        .sort()[0];
      const head = {
        id,
        name: unique,
        summary: flow.manifest.summary,
        headHash: String(row.hash),
        createdAt,
        updatedAt: flow.registeredAt,
        origin: { kind: row.hash === `sha256:${"0".repeat(63)}1` ? "demo" : "import" },
      };
      insertHead.run(id, unique, flow.manifest.summary, JSON.stringify(head));
    }
    step(options, "fill_confirmations");
    const insertConfirmation = db.prepare("INSERT INTO confirmations VALUES (?, ?, ?)");
    let confirmations = 0;
    for (const row of db
      .prepare(
        "SELECT c.flow_id, c.hash, c.at, p.pins FROM capability_consents c LEFT JOIN consent_pins p ON p.flow_id = c.flow_id ORDER BY c.rowid",
      )
      .all()) {
      let hash: unknown;
      let at: unknown;
      try {
        hash = JSON.parse(String(row.hash));
        at = JSON.parse(String(row.at));
      } catch {
        continue;
      }
      if (typeof hash !== "string" || typeof at !== "string") continue;
      let pins = { skills: {}, folders: {} };
      if (row.pins !== null) {
        try {
          const parsed = JSON.parse(String(row.pins)) as {
            skills: Record<string, string>;
            folders: Record<string, unknown>;
          };
          if (
            parsed &&
            typeof parsed.skills === "object" &&
            parsed.skills &&
            typeof parsed.folders === "object" &&
            parsed.folders
          )
            pins = parsed;
        } catch {}
      }
      const confirmation = {
        flowId: String(row.flow_id),
        hash,
        at,
        by: "migration",
        onItsOwn: [],
        pins,
        legacy: true,
      };
      insertConfirmation.run(String(row.flow_id), hash, JSON.stringify(confirmation));
      confirmations++;
    }
    step(options, "fill_call_grants");
    const insertGrant = db.prepare("INSERT INTO call_grants VALUES (?, ?, ?, ?, ?, ?)");
    let grants = 0;
    for (const row of db
      .prepare(
        "SELECT g.run_id, g.tool, g.item_key FROM grants g JOIN runs r ON r.id = g.run_id WHERE r.state NOT IN ('done', 'failed') ORDER BY g.rowid",
      )
      .all()) {
      const text = String(row.tool);
      const separator = text.indexOf("#");
      const tool = separator < 0 ? text : text.slice(0, separator);
      const digest = separator < 0 ? "*" : text.slice(separator + 1);
      let stepId = "*";
      if (separator >= 0) {
        for (const decision of db
          .prepare("SELECT data FROM approvals WHERE run_id = ? ORDER BY rowid")
          .all(String(row.run_id))) {
          try {
            const value = JSON.parse(String(decision.data)) as {
              kind?: string;
              stepId?: string;
              approves?: string[];
            };
            if (
              value.kind === "risky_action" &&
              Array.isArray(value.approves) &&
              value.approves.includes(text) &&
              typeof value.stepId === "string"
            ) {
              stepId = value.stepId;
              break;
            }
          } catch {}
        }
      }
      const grant = {
        runId: String(row.run_id),
        stepId,
        itemKey: String(row.item_key),
        tool,
        digest,
        kind: "migrated",
        createdAt: (options?.now?.() ?? new Date()).toISOString(),
      };
      insertGrant.run(grant.runId, stepId, grant.itemKey, tool, digest, JSON.stringify(grant));
      grants++;
    }
    step(options, "write_audit");
    if (!empty) {
      const skipped = db
        .prepare("SELECT data FROM approvals")
        .all()
        .filter((row) => {
          try {
            JSON.parse(String(row.data));
            return false;
          } catch {
            return true;
          }
        }).length;
      const detail = {
        from: version,
        to: 7,
        backup,
        flows: flows.length,
        confirmations,
        grants,
        skipped,
        renames,
      };
      db.prepare("INSERT INTO audit_log (at, kind, detail) VALUES (?, 'store_migrated', ?)").run(
        (options?.now?.() ?? new Date()).toISOString(),
        JSON.stringify(detail),
      );
    }
    step(options, "set_version");
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
