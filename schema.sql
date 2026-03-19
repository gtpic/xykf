CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_topic_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    sender TEXT, 
    content TEXT,
    is_read INTEGER DEFAULT 0, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
);

INSERT OR IGNORE INTO config (key, value) VALUES ('admin_username', 'admin');
INSERT OR IGNORE INTO config (key, value) VALUES ('admin_password', '123456');
INSERT OR IGNORE INTO config (key, value) VALUES ('tg_bot_token', '');
INSERT OR IGNORE INTO config (key, value) VALUES ('tg_chat_id', '');
