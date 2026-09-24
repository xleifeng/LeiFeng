CREATE TABLE IF NOT EXISTS saved_links (
  id TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  info_hash TEXT,
  seed_ref TEXT,
  total_bytes INTEGER,
  private_space INTEGER NOT NULL DEFAULT 0,
  private_payload TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  auto_saved INTEGER NOT NULL DEFAULT 1,
  last_downloaded_at INTEGER,
  local_revision INTEGER NOT NULL,
  remote_revision TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS saved_link_files (link_id TEXT NOT NULL REFERENCES saved_links(id) ON DELETE CASCADE, file_index INTEGER NOT NULL, relative_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, PRIMARY KEY(link_id, file_index));
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS saved_link_tags (link_id TEXT NOT NULL REFERENCES saved_links(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(link_id, tag_id));
CREATE INDEX IF NOT EXISTS links_updated_idx ON saved_links(updated_at DESC, id);
