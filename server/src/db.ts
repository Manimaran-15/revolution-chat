import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('direct','group')),
  title TEXT,
  avatar_url TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','video','file','voice','system')),
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS read_receipts (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS message_hidden (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS call_logs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ringing',
  started_at TEXT NOT NULL,
  connected_at TEXT,
  ended_at TEXT,
  hidden_by_caller INTEGER NOT NULL DEFAULT 0,
  hidden_by_callee INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON call_logs(caller_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON call_logs(callee_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
`);

export function migrate() {
  db.exec('SELECT 1');
  return true;
}

export async function seed() {
  const count = Number(db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
  if (count > 0) return false;
  const now = new Date().toISOString();
  const users = [
    ['u-demo', 'Mani Kumar', 'demo@revolution.chat'],
    ['u-priya', 'Priya', 'priya@revolution.chat'],
    ['u-arun', 'Arun', 'arun@revolution.chat']
  ];
  const insertUser = db.prepare('INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  for (const [id, name, email] of users) {
    const hash = await argon2.hash('Password123!');
    insertUser.run(id, name, email, hash, now, now);
  }
  const conversationId = 'c-demo';
  db.prepare('INSERT INTO conversations (id,type,title,created_by,created_at) VALUES (?,?,?,?,?)').run(conversationId, 'direct', null, 'u-demo', now);
  const member = db.prepare('INSERT INTO conversation_members (conversation_id,user_id,joined_at) VALUES (?,?,?)');
  member.run(conversationId, 'u-demo', now);
  member.run(conversationId, 'u-priya', now);
  const msg = db.prepare('INSERT INTO messages (id,conversation_id,sender_id,body,kind,created_at) VALUES (?,?,?,?,?,?)');
  msg.run('m-welcome-1', conversationId, 'u-priya', 'Hey! Welcome to Revolution Chat 👋', 'text', now);
  msg.run('m-welcome-2', conversationId, 'u-demo', 'Thanks! Let’s build something great.', 'text', new Date(Date.now() + 1000).toISOString());
  return true;
}

if (process.argv[2] === 'migrate') migrate();
if (process.argv[2] === 'seed') seed();
