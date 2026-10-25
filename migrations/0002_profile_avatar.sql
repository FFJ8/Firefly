CREATE TABLE IF NOT EXISTS profile_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  avatar TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
