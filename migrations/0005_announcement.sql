CREATE TABLE IF NOT EXISTS announcement_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO announcement_settings (id, content, updated_at)
VALUES (1, '欢迎来到我的博客！', '2026-10-28T00:00:00.000Z');
