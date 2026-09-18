// db/database.js
// Very small SQLite wrapper. Handles users + messages, and the
// auto-expiry logic that wipes messages after MESSAGE_LIFETIME_MS.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chat.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
`);

const MESSAGE_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes, per the brief

function deleteExpiredMessages() {
  const cutoff = Date.now() - MESSAGE_LIFETIME_MS;
  db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff);
}

// Sweep every 30 seconds so nothing lingers past its 30-minute life.
setInterval(deleteExpiredMessages, 30 * 1000);

module.exports = {
  db,
  MESSAGE_LIFETIME_MS,
  deleteExpiredMessages,

  createUser(username, passwordHash) {
    const stmt = db.prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    );
    return stmt.run(username, passwordHash, Date.now());
  },

  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  countUsers() {
    return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  },

  insertMessage(sender, body) {
    deleteExpiredMessages();
    const stmt = db.prepare(
      'INSERT INTO messages (sender, body, created_at) VALUES (?, ?, ?)'
    );
    const info = stmt.run(sender, body, Date.now());
    return { id: info.lastInsertRowid, sender, body, created_at: Date.now() };
  },

  getActiveMessages() {
    deleteExpiredMessages();
    return db.prepare('SELECT * FROM messages ORDER BY created_at ASC').all();
  }
};
