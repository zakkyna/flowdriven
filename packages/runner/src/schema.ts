export const SCHEMA = `
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

export const HARNESS_STATE_SCHEMA = "CREATE TABLE harness_state (id TEXT PRIMARY KEY, data TEXT NOT NULL);";

export const USAGE_SCHEMA = `
CREATE TABLE usage_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, item_key TEXT NOT NULL, attempt INTEGER NOT NULL, kind TEXT NOT NULL, harness TEXT NOT NULL, models TEXT NOT NULL, turns INTEGER NOT NULL, wall_ms INTEGER NOT NULL, queued_ms INTEGER NOT NULL, memory_peak_mb REAL, exit TEXT NOT NULL, cost_usd REAL);
CREATE INDEX usage_events_run ON usage_events (run_id);
CREATE TABLE settings (name TEXT PRIMARY KEY, data TEXT NOT NULL);
`;
