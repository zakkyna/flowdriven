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

export const TRIGGER_SCHEMA = `
CREATE TABLE triggers (flow_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (flow_id, idx));
CREATE TABLE fire_keys (flow_id TEXT NOT NULL, idx INTEGER NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (flow_id, idx, key));
`;

export const CAPABILITY_SCHEMA =
  "CREATE TABLE capability_consents (flow_id TEXT PRIMARY KEY, hash TEXT NOT NULL, at TEXT NOT NULL);";

export const PINS_SCHEMA = "CREATE TABLE consent_pins (flow_id TEXT PRIMARY KEY, pins TEXT NOT NULL);";

export const SCHEMA_V7 = `
CREATE TABLE flow_heads (id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT NOT NULL, deleted_at TEXT, data TEXT NOT NULL);
CREATE UNIQUE INDEX flow_heads_name ON flow_heads (name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE TABLE confirmations (flow_id TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE standing_rules (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX standing_rules_flow ON standing_rules (flow_id, state);
CREATE TABLE call_grants (run_id TEXT NOT NULL, step_id TEXT NOT NULL, item_key TEXT NOT NULL, tool TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, step_id, item_key, tool, digest));
CREATE TABLE schedules (flow_id TEXT PRIMARY KEY, type TEXT NOT NULL, after_flow_id TEXT, data TEXT NOT NULL);
CREATE INDEX schedules_after ON schedules (after_flow_id);
CREATE TABLE starts (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, at TEXT NOT NULL, source TEXT NOT NULL, outcome TEXT NOT NULL, key TEXT, data TEXT NOT NULL);
CREATE UNIQUE INDEX starts_key ON starts (flow_id, key) WHERE key IS NOT NULL;
CREATE INDEX starts_flow_at ON starts (flow_id, at);
CREATE INDEX starts_outcome_at ON starts (outcome, at);
CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX chats_updated ON chats (updated_at);
CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, seq INTEGER NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, card_type TEXT, card_state TEXT, search_text TEXT, data TEXT NOT NULL);
CREATE UNIQUE INDEX messages_chat_seq ON messages (chat_id, seq);
CREATE INDEX messages_card ON messages (card_type, card_state) WHERE card_type IS NOT NULL;
CREATE TABLE drafts (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX drafts_chat ON drafts (chat_id);
CREATE TABLE waiting_questions (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, kind TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE UNIQUE INDEX waiting_questions_open ON waiting_questions (flow_id) WHERE state = 'open';
CREATE INDEX waiting_questions_chat ON waiting_questions (chat_id);
CREATE TABLE remembered (flow_id TEXT NOT NULL, kind TEXT NOT NULL, input_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (flow_id, kind, input_id));
ALTER TABLE usage_events ADD COLUMN billing TEXT;
CREATE INDEX runs_flow ON runs (flow_id);
CREATE INDEX runs_state ON runs (state);
CREATE INDEX approvals_run ON approvals (run_id);
CREATE INDEX approvals_state ON approvals (state);
CREATE INDEX audit_log_run ON audit_log (run_id);
CREATE INDEX usage_events_at ON usage_events (at);
`;
