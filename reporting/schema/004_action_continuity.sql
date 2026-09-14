BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS action_records (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  wording TEXT NOT NULL,
  display_label TEXT NOT NULL,
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'carried_over', 'completed', 'abandoned')),
  theme TEXT,
  themes_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  carried_from_week TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, week_key, category_id)
);

CREATE INDEX IF NOT EXISTS idx_action_records_week
  ON action_records (week_key, category_id, status);
CREATE INDEX IF NOT EXISTS idx_action_records_owner
  ON action_records (owner, week_key);
CREATE INDEX IF NOT EXISTS idx_action_records_theme
  ON action_records (theme, week_key);
CREATE INDEX IF NOT EXISTS idx_action_records_source
  ON action_records (source_system, source_id, category_id, week_key);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (4, 'action_continuity', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
