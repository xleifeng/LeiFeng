CREATE INDEX IF NOT EXISTS history_private_idx ON download_history(private_space, completed_at DESC, id);
CREATE INDEX IF NOT EXISTS links_private_idx ON saved_links(private_space, updated_at DESC, id);
