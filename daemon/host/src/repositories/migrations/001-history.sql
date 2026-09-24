CREATE TABLE IF NOT EXISTS download_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  display_name TEXT,
  source TEXT,
  source_fingerprint TEXT NOT NULL,
  save_path TEXT,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  removed_at INTEGER,
  private_space INTEGER NOT NULL DEFAULT 0,
  private_payload TEXT,
  remote_node_id TEXT,
  seed_ref TEXT,
  deleted_at INTEGER,
  UNIQUE(task_id, event_revision, result)
);
CREATE INDEX IF NOT EXISTS history_completed_idx ON download_history(completed_at DESC, id);
CREATE INDEX IF NOT EXISTS history_task_idx ON download_history(task_id);
CREATE INDEX IF NOT EXISTS history_fingerprint_idx ON download_history(source_fingerprint);
