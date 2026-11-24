import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { triggerFlow } from "./trigger-rig.ts";

const SCHEMA = `
CREATE TABLE flows (id TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, hash));
CREATE TABLE runs (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE steps (run_id TEXT NOT NULL, step_id TEXT NOT NULL, item_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, step_id, item_key));
CREATE TABLE items (run_id TEXT NOT NULL, loop_id TEXT NOT NULL, key TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, loop_id, position));
CREATE TABLE seen (flow_id TEXT NOT NULL, loop_id TEXT NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (flow_id, loop_id, key));
CREATE TABLE approvals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE grants (run_id TEXT NOT NULL, tool TEXT NOT NULL, item_key TEXT NOT NULL, PRIMARY KEY (run_id, tool, item_key));
CREATE TABLE counters (name TEXT NOT NULL, day TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (name, day));
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, run_id TEXT, detail TEXT NOT NULL);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

const HARNESS_STATE_SCHEMA = "CREATE TABLE harness_state (id TEXT PRIMARY KEY, data TEXT NOT NULL);";

const USAGE_SCHEMA = `
CREATE TABLE usage_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, item_key TEXT NOT NULL, attempt INTEGER NOT NULL, kind TEXT NOT NULL, harness TEXT NOT NULL, models TEXT NOT NULL, turns INTEGER NOT NULL, wall_ms INTEGER NOT NULL, queued_ms INTEGER NOT NULL, memory_peak_mb REAL, exit TEXT NOT NULL, cost_usd REAL);
CREATE INDEX usage_events_run ON usage_events (run_id);
CREATE TABLE settings (name TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

const TRIGGER_SCHEMA = `
CREATE TABLE triggers (flow_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (flow_id, idx));
CREATE TABLE fire_keys (flow_id TEXT NOT NULL, idx INTEGER NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (flow_id, idx, key));
`;

const CAPABILITY_SCHEMA =
  "CREATE TABLE capability_consents (flow_id TEXT PRIMARY KEY, hash TEXT NOT NULL, at TEXT NOT NULL);";

const PINS_SCHEMA = "CREATE TABLE consent_pins (flow_id TEXT PRIMARY KEY, pins TEXT NOT NULL);";

export function makeStoreV6(folder: string, options?: { clock?: () => Date }): string {
  const path = join(folder, "flowdriven.sqlite");
  const db = new DatabaseSync(path);
  const at = (options?.clock?.() ?? new Date("2026-11-21T03:00:00.000Z")).toISOString();
  db.exec(
    `${SCHEMA} ${HARNESS_STATE_SCHEMA} ${USAGE_SCHEMA} ${TRIGGER_SCHEMA} ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6;`,
  );
  const flow = db.prepare("INSERT INTO flows VALUES (?, ?, ?)");
  for (const [id, hash, name] of [
    ["example.fill-timesheet", "H1", "Fill timesheet"],
    ["example.fill-timesheet", "H2", "Fill timesheet"],
    ["example.build-apk", `sha256:${"0".repeat(63)}1`, "Build APK"],
    ["example.job-review", "H1", "Fill timesheet"],
  ] as const) {
    flow.run(
      id,
      hash,
      JSON.stringify({
        id,
        hash,
        version: "1",
        manifest: { ...triggerFlow(id, [{ kind: "schedule", every: "1h" }]), name, summary: `${name} flow` },
        files: {},
        registeredAt:
          id === "example.fill-timesheet" && hash === "H1"
            ? new Date(Date.parse(at) - 60000).toISOString()
            : at,
      }),
    );
  }
  db.prepare("INSERT INTO capability_consents VALUES (?, ?, ?)").run(
    "example.fill-timesheet",
    JSON.stringify("H2"),
    JSON.stringify("2026"),
  );
  db.prepare("INSERT INTO capability_consents VALUES (?, ?, ?)").run(
    "example.build-apk",
    JSON.stringify("H0"),
    JSON.stringify("2026"),
  );
  const run = db.prepare("INSERT INTO runs VALUES (?, ?, ?, ?)");
  for (const state of [
    "queued",
    "checking",
    "blocked",
    "running",
    "waiting_approval",
    "retrying",
    "interrupted",
    "done",
    "failed",
  ]) {
    run.run(
      state,
      "example.fill-timesheet",
      state,
      JSON.stringify({
        id: state,
        flowId: "example.fill-timesheet",
        flowHash: "H2",
        flowVersion: "1",
        state,
        project: join(folder, "project"),
        inputs: {},
        params: {},
        requirements: [],
        startedAt: at,
      }),
    );
  }
  db.exec(`INSERT INTO steps VALUES ('running','step','','{"runId":"running","stepId":"step","itemKey":"","state":"pending","attempts":[],"outputs":{},"checks":[]}'); INSERT INTO items VALUES ('running','loop','item',0,'{"runId":"running","loopId":"loop","key":"item","position":0,"item":"item","status":"pending"}');
    INSERT INTO seen VALUES ('example.fill-timesheet','loop','item','2026');
    INSERT INTO approvals VALUES ('bad','running','pending','invalid');
    INSERT INTO grants VALUES ('waiting_approval','mcp__x__send#digest',''), ('waiting_approval','pick',''), ('done','pick','');
    INSERT INTO counters VALUES ('grant-used:waiting_approval::mcp__x__send#digest','run',1);
    INSERT INTO fire_keys VALUES ('example.fill-timesheet',0,'key','2026');
    INSERT INTO settings VALUES ('keeper','{}'), ('quota:claude-code','{}'), ('weekly:claude-code','{}');
    INSERT INTO harness_state VALUES ('claude-code','{"id":"claude-code","consent":"given"}');
    INSERT INTO usage_events (at,run_id,step_id,item_key,attempt,kind,harness,models,turns,wall_ms,queued_ms,exit) VALUES ('2026','running','step','',1,'test','claude-code','[]',1,1,0,'ok');`);
  db.prepare("INSERT INTO consent_pins VALUES (?, ?)").run(
    "example.fill-timesheet",
    JSON.stringify({
      skills: { skill: "sha256:skill" },
      folders: { project: { path: join(folder, "project"), access: "read_write" } },
    }),
  );
  db.prepare("INSERT INTO triggers VALUES (?, ?, ?)").run(
    "example.fill-timesheet",
    0,
    JSON.stringify({
      flowId: "example.fill-timesheet",
      index: 0,
      enabled: true,
      hash: "H2",
      spec: JSON.stringify(
        triggerFlow("example.fill-timesheet", [{ kind: "schedule", every: "1h" }]).triggers[0],
      ),
      enabledAt: at,
    }),
  );
  const approval = db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?)");
  for (const [id, kind, runId, state] of [
    ["ask", "ask", "running", "pending"],
    ["signoff", "result_sign_off", "running", "approved"],
    ["risk", "risky_action", "waiting_approval", "pending"],
  ] as const) {
    approval.run(
      id,
      runId,
      state,
      JSON.stringify({
        id,
        kind,
        runId,
        stepId: "step",
        itemKey: "",
        summary: id,
        payload: {},
        approves: kind === "risky_action" ? ["mcp__x__send#digest", "pick"] : [],
        onExpiry: "end",
        createdAt: at,
        expiresAt: at,
        state,
      }),
    );
  }
  const audit = db.prepare("INSERT INTO audit_log (at,kind,detail) VALUES (?, 'test', '{}')");
  for (let i = 0; i < 12; i++) audit.run(at);
  db.close();
  return path;
}

export function readStoreV6(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    const rows = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]),
    );
    return { version: db.prepare("PRAGMA user_version").get()?.user_version, tables, rows };
  } finally {
    db.close();
  }
}

export function makeOlderStore(folder: string, version: number): string {
  const path = join(folder, "flowdriven.sqlite");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  if (version >= 2) db.exec(HARNESS_STATE_SCHEMA);
  if (version >= 3) db.exec(USAGE_SCHEMA);
  if (version >= 4) db.exec(TRIGGER_SCHEMA);
  if (version >= 5) db.exec(CAPABILITY_SCHEMA);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
  return path;
}
