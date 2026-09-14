PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE snapshot_envelopes_v2 (
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

INSERT INTO snapshot_envelopes_v2
  (source_system, source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at)
SELECT
  'legacy', source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at
FROM snapshot_envelopes;

CREATE TABLE snapshot_summary_state_v2 (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
  stale_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id),
  FOREIGN KEY (source_system, source_id, week_key, category_id)
    REFERENCES snapshot_envelopes_v2 (source_system, source_id, week_key, category_id)
    ON DELETE CASCADE
);

INSERT INTO snapshot_summary_state_v2
  (source_system, source_id, week_key, category_id, is_stale, stale_reason, updated_at)
SELECT
  'legacy', source_id, week_key, category_id, is_stale, stale_reason, updated_at
FROM snapshot_summary_state;

CREATE TABLE snapshot_redactions_v2 (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  aggregate_json TEXT,
  redacted_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id)
);

INSERT INTO snapshot_redactions_v2
  (source_system, source_id, week_key, category_id, reason, aggregate_json, redacted_at)
SELECT
  'legacy', source_id, week_key, category_id, reason, NULL, redacted_at
FROM snapshot_redactions;

DROP TABLE snapshot_summary_state;
DROP TABLE snapshot_redactions;
DROP TABLE snapshot_envelopes;

ALTER TABLE snapshot_envelopes_v2 RENAME TO snapshot_envelopes;
ALTER TABLE snapshot_summary_state_v2 RENAME TO snapshot_summary_state;
ALTER TABLE snapshot_redactions_v2 RENAME TO snapshot_redactions;

CREATE INDEX idx_snapshot_envelopes_source_system
  ON snapshot_envelopes (source_system);
CREATE INDEX idx_snapshot_envelopes_source_id
  ON snapshot_envelopes (source_id);
CREATE INDEX idx_snapshot_envelopes_week_key
  ON snapshot_envelopes (week_key);
CREATE INDEX idx_snapshot_envelopes_category_id
  ON snapshot_envelopes (category_id);
CREATE INDEX idx_snapshot_envelopes_schema_version
  ON snapshot_envelopes (schema_version);
CREATE INDEX idx_snapshot_redactions_state
  ON snapshot_redactions (source_system, redacted_at);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (2, 'snapshot_store_source_system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;

PRAGMA foreign_keys = ON;
