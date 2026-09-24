CREATE VIRTUAL TABLE IF NOT EXISTS download_history_fts USING fts5(history_id UNINDEXED, display_name, source, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE IF NOT EXISTS saved_links_fts USING fts5(link_id UNINDEXED, title, source, tags, tokenize='unicode61 remove_diacritics 2');
