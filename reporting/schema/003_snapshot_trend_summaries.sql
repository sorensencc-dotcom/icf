BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS snapshot_trend_summaries (
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  window INTEGER NOT NULL CHECK (window IN (4, 8, 12)),
  from_week TEXT NOT NULL,
  to_week TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
  stale_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_system, source_id, category_id, window, from_week, to_week)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_trend_summaries_lookup
  ON snapshot_trend_summaries (source_system, source_id, category_id, window, to_week);
CREATE INDEX IF NOT EXISTS idx_snapshot_trend_summaries_stale
  ON snapshot_trend_summaries (is_stale, category_id, from_week, to_week);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (3, 'snapshot_trend_summaries', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
