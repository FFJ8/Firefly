ALTER TABLE online_posts ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE online_posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE online_posts ADD COLUMN series TEXT NOT NULL DEFAULT '';
ALTER TABLE online_posts ADD COLUMN series_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX online_posts_created ON online_posts(created_at DESC, id DESC);
CREATE INDEX online_posts_category ON online_posts(category, created_at DESC);
CREATE INDEX online_posts_series ON online_posts(series, series_order, created_at);
