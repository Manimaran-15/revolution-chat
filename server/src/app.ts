import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { db } from './db.js';
import { config } from './config.js';
import { hashPassword, signToken, verifyPassword, verifyToken, type AuthUser } from './auth.js';
import { deleteAccountSchema, groupSchema, loginSchema, messageSchema, profileSchema, reactionSchema, signupSchema } from './validation.js';

/** Lets REST routes tell the socket layer about new conversations without a circular import. */
export const events = new EventEmitter();

export const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// CORS: allow the configured origins, local-network dev origins, and *same-origin* requests.
// Same-origin matters when the built app is opened through a public tunnel/domain (any network).
app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  const allow = (ok: boolean) => cb(ok ? null : new Error('CORS origin not allowed'), { origin: ok, credentials: true });
  if (!origin || config.allowAnyOrigin || config.allowedOrigins.includes(origin)) return allow(true);
  try {
    const originHost = new URL(origin).host;
    const hosts = [req.headers.host, String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()].filter(Boolean);
    if (hosts.includes(originHost)) return allow(true);
  } catch { /* malformed Origin header */ }
  if (config.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):(5173|4173)$/.test(origin)) return allow(true);
  allow(false);
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Browsers send e.g. "audio/webm;codecs=opus" for voice notes, so compare only the base type.
    const baseType = file.mimetype.split(';')[0].trim();
    const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime|x-matroska|x-msvideo|3gpp)|audio\/(webm|ogg|mpeg|mp4|x-m4a|aac|wav)|application\/(pdf|zip|x-zip-compressed|x-rar-compressed|vnd\.rar|x-7z-compressed|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/(plain|csv))$/i;
    cb(null, allowed.test(baseType));
  }
});

const publicUser = (row: any) => ({ id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url, bio: row.bio, createdAt: row.created_at });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const user = verifyToken(header.slice(7));
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

declare global { namespace Express { interface Request { user?: AuthUser } } }

function isMember(userId: string, conversationId: string) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);
}
function getConversationForUser(userId: string, conversationId: string) {
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM conversation_members cm2 WHERE cm2.conversation_id=c.id) AS member_count,
    (SELECT u.id FROM users u JOIN conversation_members x1 ON x1.user_id=u.id WHERE x1.conversation_id=c.id AND x1.user_id<>? LIMIT 1) AS other_user_id,
    (SELECT u.name FROM users u JOIN conversation_members x2 ON x2.user_id=u.id WHERE x2.conversation_id=c.id AND x2.user_id<>? LIMIT 1) AS other_name,
    (SELECT u.avatar_url FROM users u JOIN conversation_members x3 ON x3.user_id=u.id WHERE x3.conversation_id=c.id AND x3.user_id<>? LIMIT 1) AS other_avatar
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND cm.user_id=?`).get(userId, userId, userId, conversationId, userId) as any;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'revolution-chat', time: new Date().toISOString() }));

app.post('/api/auth/signup', authLimiter, async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body);
    const email = data.email.toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email is already registered' });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);
    db.prepare('INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, data.name, email, passwordHash, now, now);
    const user = { id, name: data.name, email };
    res.status(201).json({ user, token: signToken(user) });
  } catch (e) { next(e); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(data.email.toLowerCase()) as any;
    if (!row || !(await verifyPassword(row.password_hash, data.password))) return res.status(401).json({ error: 'Invalid email or password' });
    const user = { id: row.id, name: row.name, email: row.email };
    res.json({ user: publicUser(row), token: signToken(user) });
  } catch (e) { next(e); }
});
app.post('/api/auth/logout', requireAuth, (_req, res) => res.json({ ok: true }));
app.get('/api/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user!.id) as any;
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(row) });
});

app.get('/api/users', requireAuth, (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const rows = search ? db.prepare('SELECT * FROM users WHERE id<>? AND (name LIKE ? OR email LIKE ?) ORDER BY name LIMIT 20').all(req.user!.id, `%${search}%`, `%${search}%`) : db.prepare('SELECT * FROM users WHERE id<>? ORDER BY name LIMIT 20').all(req.user!.id);
  res.json({ users: rows.map(publicUser) });
});

app.patch('/api/profile', requireAuth, (req, res, next) => {
  try {
    const data = profileSchema.parse(req.body);
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET name=?, bio=?, updated_at=? WHERE id=?').run(data.name, data.bio, now, req.user!.id);
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user!.id) as any;
    res.json({ user: publicUser(row) });
  } catch (e) { next(e); }
});

const PREVIEW = `CASE WHEN m.deleted_at IS NOT NULL THEN '🚫 This message was deleted' WHEN m.body<>'' THEN m.body WHEN m.kind='image' THEN '📷 Photo' WHEN m.kind='video' THEN '🎥 Video' WHEN m.kind='voice' THEN '🎙️ Voice message' ELSE '📎 File' END`;
app.get('/api/conversations', requireAuth, (req, res) => {
  const me = req.user!.id;
  const rows = db.prepare(`SELECT c.id,c.type,c.title,c.avatar_url,c.created_by,c.created_at,
    (SELECT ${PREVIEW} FROM messages m WHERE m.conversation_id=c.id AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY m.created_at DESC LIMIT 1) last_body,
    (SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY m.created_at DESC LIMIT 1) last_at,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.deleted_at IS NULL
       AND m.created_at > COALESCE((SELECT m2.created_at FROM read_receipts rr JOIN messages m2 ON m2.id=rr.message_id WHERE rr.conversation_id=c.id AND rr.user_id=?),'')) unread,
    (SELECT COUNT(*) FROM conversation_members cm6 WHERE cm6.conversation_id=c.id) member_count,
    (SELECT u.id FROM users u JOIN conversation_members cm5 ON cm5.user_id=u.id WHERE cm5.conversation_id=c.id AND cm5.user_id<>? LIMIT 1) other_user_id,
    (SELECT u.name FROM users u JOIN conversation_members cm3 ON cm3.user_id=u.id WHERE cm3.conversation_id=c.id AND cm3.user_id<>? LIMIT 1) other_name,
    (SELECT u.avatar_url FROM users u JOIN conversation_members cm4 ON cm4.user_id=u.id WHERE cm4.conversation_id=c.id AND cm4.user_id<>? LIMIT 1) other_avatar
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=? ORDER BY COALESCE(last_at,c.created_at) DESC`).all(me, me, me, me, me, me, me, me) as any[];
  res.json({ conversations: rows });
});

// Mark a conversation as read (clears the Unread badge).
app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!isMember(req.user!.id, id)) return res.status(403).json({ error: 'Not a conversation member' });
  const last = db.prepare('SELECT id FROM messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(id) as any;
  if (last) db.prepare(`INSERT INTO read_receipts (conversation_id,user_id,message_id,read_at) VALUES (?,?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET message_id=excluded.message_id,read_at=excluded.read_at`).run(id, req.user!.id, last.id, new Date().toISOString());
  res.json({ ok: true });
});

app.post('/api/conversations/direct', requireAuth, (req, res, next) => {
  try {
    const otherId = String(req.body.userId ?? '');
    if (!otherId || otherId === req.user!.id) return res.status(400).json({ error: 'Choose another user' });
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(otherId)) return res.status(404).json({ error: 'User not found' });
    const existing = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id JOIN conversation_members b ON b.conversation_id=c.id WHERE c.type='direct' AND a.user_id=? AND b.user_id=? AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id=c.id)=2 LIMIT 1`).get(req.user!.id, otherId) as any;
    if (existing) return res.json({ conversation: getConversationForUser(req.user!.id, existing.id) });
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO conversations (id,type,created_by,created_at) VALUES (?,?,?,?)').run(id, 'direct', req.user!.id, now);
      db.prepare('INSERT INTO conversation_members (conversation_id,user_id,joined_at) VALUES (?,?,?)').run(id, req.user!.id, now);
      db.prepare('INSERT INTO conversation_members (conversation_id,user_id,joined_at) VALUES (?,?,?)').run(id, otherId, now);
    });
    tx();
    events.emit('conversation:created', id, [req.user!.id, otherId]);
    res.status(201).json({ conversation: getConversationForUser(req.user!.id, id) });
  } catch (e) { next(e); }
});

app.post('/api/groups', requireAuth, (req, res, next) => {
  try {
    const data = groupSchema.parse(req.body);
    const memberIds = [...new Set([req.user!.id, ...data.memberIds])];
    const existingCount = Number(db.prepare(`SELECT COUNT(*) c FROM users WHERE id IN (${memberIds.map(() => '?').join(',')})`).get(...memberIds).c);
    if (existingCount !== memberIds.length) return res.status(400).json({ error: 'One or more members do not exist' });
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO conversations (id,type,title,created_by,created_at) VALUES (?,?,?,?,?)').run(id, 'group', data.title, req.user!.id, now);
      const insert = db.prepare('INSERT INTO conversation_members (conversation_id,user_id,joined_at) VALUES (?,?,?)');
      memberIds.forEach(uid => insert.run(id, uid, now));
    });
    tx();
    events.emit('conversation:created', id, memberIds);
    res.status(201).json({ conversation: getConversationForUser(req.user!.id, id) });
  } catch (e) { next(e); }
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conversationId = req.params.id;
  if (!isMember(req.user!.id, conversationId)) return res.status(403).json({ error: 'Not a conversation member' });
  const limit = Math.min(Math.max(Number(req.query.limit ?? 40), 1), 80);
  const before = String(req.query.before ?? '');
  let rows: any[];
  if (before) {
    const pivot = db.prepare('SELECT created_at FROM messages WHERE id=? AND conversation_id=?').get(before, conversationId) as any;
    if (!pivot) return res.status(400).json({ error: 'Invalid cursor' });
    rows = db.prepare(`SELECT m.*,u.name sender_name,u.avatar_url sender_avatar,(SELECT json_group_array(json_object('emoji',r.emoji,'userId',r.user_id)) FROM reactions r WHERE r.message_id=m.id) reactions FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) AND m.created_at < ? ORDER BY m.created_at DESC,m.id DESC LIMIT ?`).all(conversationId, req.user!.id, pivot.created_at, limit);
  } else rows = db.prepare(`SELECT m.*,u.name sender_name,u.avatar_url sender_avatar,(SELECT json_group_array(json_object('emoji',r.emoji,'userId',r.user_id)) FROM reactions r WHERE r.message_id=m.id) reactions FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY m.created_at DESC,m.id DESC LIMIT ?`).all(conversationId, req.user!.id, limit);
  rows.reverse();
  res.json({ messages: rows.map((m: any) => ({ ...m, reactions: m.reactions ? JSON.parse(m.reactions) : [] })), hasMore: rows.length === limit });
});

function createMessage(userId: string, data: any) {
  if (!isMember(userId, data.conversationId)) throw Object.assign(new Error('Not a conversation member'), { status: 403 });
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO messages (id,conversation_id,sender_id,body,kind,attachment_url,attachment_name,attachment_type,attachment_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, data.conversationId, userId, data.body, data.kind, data.attachmentUrl ?? null, data.attachmentName ?? null, data.attachmentType ?? null, data.attachmentSize ?? null, now);
  return db.prepare(`SELECT m.*,u.name sender_name,u.avatar_url sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id) as any;
}
app.post('/api/messages', requireAuth, messageLimiter, (req, res, next) => {
  try { const data = messageSchema.parse(req.body); res.status(201).json({ message: createMessage(req.user!.id, data) }); } catch (e) { next(e); }
});

app.post('/api/messages/:id/reactions', requireAuth, messageLimiter, (req, res, next) => {
  try {
    const data = reactionSchema.parse(req.body);
    const msg = db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(req.params.id) as any;
    if (!msg || !isMember(req.user!.id, msg.conversation_id)) return res.status(403).json({ error: 'Not authorized' });
    const existing = db.prepare('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?').get(req.params.id, req.user!.id) as any;
    if (existing) db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=?').run(req.params.id, req.user!.id);
    if (!existing || existing.emoji !== data.emoji) db.prepare('INSERT INTO reactions (message_id,user_id,emoji,created_at) VALUES (?,?,?,?)').run(req.params.id, req.user!.id, data.emoji, new Date().toISOString());
    const reactions = db.prepare('SELECT emoji,user_id userId FROM reactions WHERE message_id=?').all(req.params.id);
    res.json({ reactions });
  } catch (e) { next(e); }
});

// ---- call history (like WhatsApp "Calls" tab) ----
app.get('/api/calls', requireAuth, (req, res) => {
  const me = req.user!.id;
  const rows = db.prepare(`SELECT l.id,l.conversation_id,l.caller_id,l.callee_id,l.video,l.status,l.started_at,l.connected_at,l.ended_at,
    CASE WHEN l.caller_id=? THEN cu.id ELSE ca.id END peer_id,
    CASE WHEN l.caller_id=? THEN cu.name ELSE ca.name END peer_name,
    CASE WHEN l.caller_id=? THEN cu.avatar_url ELSE ca.avatar_url END peer_avatar
    FROM call_logs l JOIN users ca ON ca.id=l.caller_id JOIN users cu ON cu.id=l.callee_id
    WHERE ((l.caller_id=? AND l.hidden_by_caller=0) OR (l.callee_id=? AND l.hidden_by_callee=0)) AND l.status<>'ringing'
    ORDER BY l.started_at DESC LIMIT 100`).all(me, me, me, me, me) as any[];
  res.json({ calls: rows.map(r => ({ ...r, video: !!r.video, duration: r.connected_at && r.ended_at ? Math.max(0, Math.round((Date.parse(r.ended_at) - Date.parse(r.connected_at)) / 1000)) : 0 })) });
});
app.delete('/api/calls/:id', requireAuth, (req, res) => {
  const me = req.user!.id;
  db.prepare('UPDATE call_logs SET hidden_by_caller=CASE WHEN caller_id=? THEN 1 ELSE hidden_by_caller END, hidden_by_callee=CASE WHEN callee_id=? THEN 1 ELSE hidden_by_callee END WHERE id=?').run(me, me, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/calls', requireAuth, (req, res) => {
  const me = req.user!.id;
  db.prepare('UPDATE call_logs SET hidden_by_caller=1 WHERE caller_id=?').run(me);
  db.prepare('UPDATE call_logs SET hidden_by_callee=1 WHERE callee_id=?').run(me);
  res.json({ ok: true });
});

// ---- delete my account (needs the password) ----
app.delete('/api/account', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { password } = deleteAccountSchema.parse(req.body ?? {});
    const me = req.user!.id;
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(me) as any;
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (!(await verifyPassword(row.password_hash, password))) return res.status(401).json({ error: 'Wrong password' });
    const affected = (db.prepare('SELECT DISTINCT user_id FROM conversation_members WHERE user_id<>? AND conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id=?)').all(me, me) as any[]).map(r => r.user_id as string);
    const files: string[] = [];
    db.transaction(() => {
      // every one-to-one chat of this user is removed; groups they created pass to another member (or are removed if empty)
      const mine = db.prepare('SELECT c.id,c.type,c.created_by FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=?').all(me) as any[];
      const doomed: string[] = [];
      for (const c of mine) {
        if (c.type === 'direct') { doomed.push(c.id); continue; }
        if (c.created_by === me) {
          const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id<>? LIMIT 1').get(c.id, me) as any;
          if (other) db.prepare('UPDATE conversations SET created_by=? WHERE id=?').run(other.user_id, c.id); else doomed.push(c.id);
        }
      }
      const collect = (sql: string, ...args: any[]) => (db.prepare(sql).all(...args) as any[]).forEach(r => r.attachment_url && files.push(String(r.attachment_url)));
      collect('SELECT attachment_url FROM messages WHERE sender_id=? AND attachment_url IS NOT NULL', me);
      doomed.forEach(id => collect('SELECT attachment_url FROM messages WHERE conversation_id=? AND attachment_url IS NOT NULL', id));
      db.prepare('DELETE FROM messages WHERE sender_id=?').run(me);
      doomed.forEach(id => db.prepare('DELETE FROM conversations WHERE id=?').run(id));
      db.prepare('DELETE FROM users WHERE id=?').run(me); // members, reactions, receipts, hidden messages and call logs go with it
    })();
    if (row.avatar_url) files.push(String(row.avatar_url));
    files.forEach(f => fs.promises.unlink(path.join(config.uploadDir, path.basename(f))).catch(() => {}));
    events.emit('user:deleted', me, affected);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/uploads', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File type not supported (or no file chosen)' });
  const safeName = req.file.filename + path.extname(req.file.originalname).toLowerCase();
  const finalPath = path.join(config.uploadDir, safeName);
  fs.renameSync(req.file.path, finalPath);
  res.status(201).json({ url: `/uploads/${safeName}`, name: req.file.originalname, type: req.file.mimetype, size: req.file.size });
});
app.use('/uploads', express.static(config.uploadDir, { maxAge: '1h' }));

// Serve the built React app from the same server so ONE public URL works on any network.
// Works from both src/ (tsx) and dist/ (compiled): both sit one level below /server.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message ?? 'Invalid input' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large' });
  if (err?.status) return res.status(err.status).json({ error: err.message });
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Resource already exists' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export { requireAuth, isMember };
