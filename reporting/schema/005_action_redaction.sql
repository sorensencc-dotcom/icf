PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE action_records_v5 (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  wording TEXT NOT NULL,
  display_label TEXT NOT NULL,
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'carried_over', 'unresolved', 'completed', 'abandoned')),
  theme TEXT,
  themes_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  carried_from_week TEXT,
  origin_source_system TEXT,
  origin_source_id TEXT,
  origin_week_key TEXT,
  origin_category_id TEXT,
  is_redacted INTEGER NOT NULL DEFAULT 0 CHECK (is_redacted IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id)
);

INSERT INTO action_records_v5
  (source_system, source_id, week_key, category_id, wording, display_label, owner,
   status, theme, themes_json, provenance_json, history_json, carried_from_week,
   origin_source_system, origin_source_id, origin_week_key, origin_category_id, is_redacted,
   created_at, updated_at)
SELECT source_system, source_id, week_key, category_id, wording, display_label, owner,
  status, theme, themes_json, provenance_json, history_json, carried_from_week,
  NULL, NULL, NULL, NULL, 0, created_at, updated_at
FROM action_records;

DROP TABLE action_records;
ALTER TABLE action_records_v5 RENAME TO action_records;

CREATE INDEX idx_action_records_week
  ON action_records (week_key, category_id, status);
CREATE INDEX idx_action_records_owner
  ON action_records (owner, week_key);
CREATE INDEX idx_action_records_theme
  ON action_records (theme, week_key);
CREATE INDEX idx_action_records_source
  ON action_records (source_system, source_id, category_id, week_key);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (5, 'action_redaction', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;

PRAGMA foreign_keys = ON;
