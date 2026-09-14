PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_envelopes (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  envelope_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id)
);

CREATE TABLE IF NOT EXISTS snapshot_summary_state (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
  stale_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id),
  FOREIGN KEY (source_system, source_id, week_key, category_id)
    REFERENCES snapshot_envelopes (source_system, source_id, week_key, category_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_redactions (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  aggregate_json TEXT,
  redacted_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_envelopes_source_system
  ON snapshot_envelopes (source_system);
CREATE INDEX IF NOT EXISTS idx_snapshot_envelopes_source_id
  ON snapshot_envelopes (source_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_envelopes_week_key
  ON snapshot_envelopes (week_key);
CREATE INDEX IF NOT EXISTS idx_snapshot_envelopes_category_id
  ON snapshot_envelopes (category_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_envelopes_schema_version
  ON snapshot_envelopes (schema_version);
CREATE INDEX IF NOT EXISTS idx_snapshot_redactions_state
  ON snapshot_redactions (source_system, redacted_at);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (1, 'snapshot_store', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
