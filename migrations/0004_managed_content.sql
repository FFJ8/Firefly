CREATE TABLE IF NOT EXISTS online_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dynamic', 'project', 'gallery')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS online_entries_kind_updated ON online_entries(kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS online_media (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
