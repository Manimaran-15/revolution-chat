import { Server } from 'socket.io';
import { db } from './db.js';
import { config } from './config.js';
import { verifyToken } from './auth.js';
import { messageSchema, reactionSchema } from './validation.js';
import { createServer } from 'node:http';
import type { AuthUser } from './auth.js';
import { app, events } from './app.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const httpServer = createServer(app);
// Node cuts requests after 5 minutes by default; big uploads on slow networks need longer.
httpServer.requestTimeout = 0;
export const io = new Server(httpServer, {
  cors: { origin: config.nodeEnv === 'production' ? config.allowedOrigins : true, methods: ['GET','POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6
});

declare module 'socket.io' { interface SocketData { user: AuthUser } }

const online = new Map<string, number>();
const roomForUser = (userId: string) => `user:${userId}`;
const roomForConversation = (id: string) => `conversation:${id}`;
const isMember = (userId: string, conversationId: string) => !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId);

// Calls that are ringing or connected right now (used to write the call history).
const activeCalls = new Map<string, { logId: string; caller: string; callee: string }>();
function finishCall(conversationId: string, endedBy: string, reason?: string) {
  const a = activeCalls.get(conversationId); if (!a) return;
  activeCalls.delete(conversationId);
  const row = db.prepare('SELECT connected_at FROM call_logs WHERE id=?').get(a.logId) as any;
  const status = row?.connected_at ? 'completed' : (reason === 'busy' || endedBy === a.callee ? 'declined' : 'missed');
  db.prepare('UPDATE call_logs SET status=?, ended_at=? WHERE id=?').run(status, new Date().toISOString(), a.logId);
}

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token ?? '');
    if (!token) throw new Error('Missing token');
    socket.data.user = verifyToken(token);
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', socket => {
  const user = socket.data.user;
  socket.join(roomForUser(user.id));
  const current = online.get(user.id) ?? 0;
  online.set(user.id, current + 1);
  io.emit('presence:update', { userId: user.id, online: true });
  // Auto-join every conversation room (runs again after every reconnect, so nothing is missed).
  const mine = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id=?').all(user.id) as { conversation_id: string }[];
  mine.forEach(r => socket.join(roomForConversation(r.conversation_id)));
  // Tell the newly connected client who is already online.
  socket.emit('presence:list', [...online.keys()]);

  socket.on('conversation:join', (conversationId: string) => {
    if (typeof conversationId === 'string' && isMember(user.id, conversationId)) socket.join(roomForConversation(conversationId));
  });

  socket.on('typing:start', (conversationId: string) => {
    if (isMember(user.id, conversationId)) socket.to(roomForConversation(conversationId)).emit('typing:update', { conversationId, userId: user.id, name: user.name, typing: true });
  });
  socket.on('typing:stop', (conversationId: string) => {
    if (isMember(user.id, conversationId)) socket.to(roomForConversation(conversationId)).emit('typing:update', { conversationId, userId: user.id, name: user.name, typing: false });
  });
  socket.on('message:read', (payload: { conversationId: string; messageId: string }) => {
    if (!isMember(user.id, payload.conversationId)) return;
    db.prepare(`INSERT INTO read_receipts (conversation_id,user_id,message_id,read_at) VALUES (?,?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET message_id=excluded.message_id,read_at=excluded.read_at`).run(payload.conversationId, user.id, payload.messageId, new Date().toISOString());
    socket.to(roomForConversation(payload.conversationId)).emit('message:read', { ...payload, userId: user.id });
  });
  socket.on('message:send', (raw: unknown, ack?: (x: any) => void) => {
    try {
      const data = messageSchema.parse(raw);
      if (!isMember(user.id, data.conversationId)) throw new Error('Not authorized');
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO messages (id,conversation_id,sender_id,body,kind,attachment_url,attachment_name,attachment_type,attachment_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, data.conversationId, user.id, data.body, data.kind, data.attachmentUrl ?? null, data.attachmentName ?? null, data.attachmentType ?? null, data.attachmentSize ?? null, now);
      const message = db.prepare(`SELECT m.*,u.name sender_name,u.avatar_url sender_avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id);
      const recipients = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id<>?').all(data.conversationId, user.id) as {user_id:string}[];
      recipients.forEach(r => io.in(roomForUser(r.user_id)).socketsJoin(roomForConversation(data.conversationId)));
      io.to(roomForConversation(data.conversationId)).emit('message:new', message);
      recipients.forEach(r => io.to(roomForUser(r.user_id)).emit('notification:new', { conversationId: data.conversationId, message }));
      ack?.({ ok: true, message });
    } catch (e: any) { ack?.({ ok: false, error: e?.issues?.[0]?.message ?? e.message ?? 'Unable to send' }); }
  });
  // Delete a message: scope 'me' hides it only for this user; 'everyone' (sender only) wipes it for all members.
  socket.on('message:delete', (payload: { messageId?: unknown; scope?: unknown }, ack?: (x: any) => void) => {
    try {
      const messageId = String(payload?.messageId ?? '');
      const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId) as any;
      if (!msg || !isMember(user.id, msg.conversation_id)) throw new Error('Not authorized');
      if (payload?.scope === 'everyone') {
        if (msg.sender_id !== user.id) throw new Error('You can only delete your own messages for everyone');
        db.prepare("UPDATE messages SET deleted_at=?, body='', attachment_url=NULL, attachment_name=NULL, attachment_type=NULL, attachment_size=NULL WHERE id=?").run(new Date().toISOString(), messageId);
        db.prepare('DELETE FROM reactions WHERE message_id=?').run(messageId);
        if (msg.attachment_url) { // also free the disk space of the uploaded file
          const file = path.join(config.uploadDir, path.basename(String(msg.attachment_url)));
          fs.promises.unlink(file).catch(() => {});
        }
        io.to(roomForConversation(msg.conversation_id)).emit('message:deleted', { messageId, conversationId: msg.conversation_id });
      } else {
        db.prepare('INSERT OR IGNORE INTO message_hidden (message_id,user_id) VALUES (?,?)').run(messageId, user.id);
        io.to(roomForUser(user.id)).emit('message:hidden', { messageId, conversationId: msg.conversation_id });
      }
      ack?.({ ok: true });
    } catch (e: any) { ack?.({ ok: false, error: e?.message ?? 'Unable to delete' }); }
  });
  // Clear chat: hides every current message of this conversation for this user only.
  socket.on('chat:clear', (payload: { conversationId?: unknown }, ack?: (x: any) => void) => {
    try {
      const id = String(payload?.conversationId ?? '');
      if (!isMember(user.id, id)) throw new Error('Not authorized');
      db.prepare('INSERT OR IGNORE INTO message_hidden (message_id,user_id) SELECT id, ? FROM messages WHERE conversation_id=?').run(user.id, id);
      ack?.({ ok: true });
    } catch (e: any) { ack?.({ ok: false, error: e?.message ?? 'Unable to clear' }); }
  });
  socket.on('reaction:toggle', (payload: unknown, ack?: (x:any)=>void) => {
    try {
      const raw = payload as { messageId?: unknown; emoji?: unknown };
      const data = reactionSchema.parse({ emoji: raw.emoji });
      const messageId = String(raw.messageId ?? '');
      if (!messageId) throw new Error('Message id is required');
      const message = db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(messageId) as any;
      if (!message || !isMember(user.id, message.conversation_id)) throw new Error('Not authorized');
      const existing = db.prepare('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?').get(messageId, user.id) as any;
      if (existing) db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=?').run(messageId, user.id);
      if (!existing || existing.emoji !== data.emoji) db.prepare('INSERT INTO reactions (message_id,user_id,emoji,created_at) VALUES (?,?,?,?)').run(messageId, user.id, data.emoji, new Date().toISOString());
      const reactions = db.prepare('SELECT emoji,user_id userId FROM reactions WHERE message_id=?').all(messageId);
      io.to(roomForConversation(message.conversation_id)).emit('message:reaction', { messageId: messageId, reactions });
      ack?.({ ok: true, reactions });
    } catch (e: any) { ack?.({ ok: false, error: e?.message ?? 'Unable to react' }); }
  });

  // ---- voice / video calls: the server only relays WebRTC signalling between the two chat members ----
  const peerOf = (conversationId: unknown): string | null => {
    if (typeof conversationId !== 'string' || !isMember(user.id, conversationId)) return null;
    const conv = db.prepare('SELECT type FROM conversations WHERE id=?').get(conversationId) as any;
    if (!conv || conv.type !== 'direct') return null;
    const row = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id<>?').get(conversationId, user.id) as any;
    return row?.user_id ?? null;
  };
  socket.on('call:invite', (p: { conversationId: string; video?: boolean }, ack?: (x: any) => void) => {
    const peer = peerOf(p?.conversationId);
    if (!peer) return ack?.({ ok: false, error: 'Calls work in one-to-one chats only' });
    const now = new Date().toISOString();
    if (!online.has(peer)) {
      db.prepare("INSERT INTO call_logs (id,conversation_id,caller_id,callee_id,video,status,started_at,ended_at) VALUES (?,?,?,?,?,'missed',?,?)").run(crypto.randomUUID(), p.conversationId, user.id, peer, p.video ? 1 : 0, now, now);
      return ack?.({ ok: false, error: 'The user is offline right now' });
    }
    const logId = crypto.randomUUID();
    db.prepare("INSERT INTO call_logs (id,conversation_id,caller_id,callee_id,video,status,started_at) VALUES (?,?,?,?,?,'ringing',?)").run(logId, p.conversationId, user.id, peer, p.video ? 1 : 0, now);
    activeCalls.set(p.conversationId, { logId, caller: user.id, callee: peer });
    io.to(roomForUser(peer)).emit('call:incoming', { conversationId: p.conversationId, video: !!p.video, from: { id: user.id, name: user.name } });
    ack?.({ ok: true });
  });
  socket.on('call:signal', (p: { to: string; conversationId: string; data: unknown }) => {
    const peer = peerOf(p?.conversationId);
    if (peer && peer === p.to) io.to(roomForUser(peer)).emit('call:signal', { from: user.id, conversationId: p.conversationId, data: p.data });
  });
  socket.on('call:connected', (p: { conversationId: string }) => {
    const a = activeCalls.get(p?.conversationId);
    if (a && (a.caller === user.id || a.callee === user.id)) db.prepare("UPDATE call_logs SET status='completed', connected_at=COALESCE(connected_at,?) WHERE id=?").run(new Date().toISOString(), a.logId);
  });
  socket.on('call:end', (p: { to: string; conversationId: string; reason?: string }) => {
    const peer = peerOf(p?.conversationId);
    if (peer && peer === p.to) finishCall(p.conversationId, user.id, p.reason);
    if (peer && peer === p.to) io.to(roomForUser(peer)).emit('call:ended', { from: user.id, conversationId: p.conversationId, reason: p.reason });
  });

  socket.on('disconnect', () => {
    const count = Math.max(0, (online.get(user.id) ?? 1) - 1);
    if (count === 0) { for (const [cid, a] of [...activeCalls]) if (a.caller === user.id || a.callee === user.id) { finishCall(cid, user.id); io.to(roomForUser(a.caller === user.id ? a.callee : a.caller)).emit('call:ended', { from: user.id, conversationId: cid }); } online.delete(user.id); io.emit('presence:update', { userId: user.id, online: false }); }
    else online.set(user.id, count);
  });
});

// When a direct chat or group is created, put every member's live sockets into its room and tell them to refresh.
events.on('conversation:created', (conversationId: string, memberIds: string[]) => {
  memberIds.forEach(uid => {
    io.in(roomForUser(uid)).socketsJoin(roomForConversation(conversationId));
    io.to(roomForUser(uid)).emit('conversation:new', { conversationId });
  });
});

// An account was deleted: log its devices out, refresh the chat lists of the people it talked to.
events.on('user:deleted', (userId: string, affected: string[]) => {
  io.in(roomForUser(userId)).disconnectSockets(true);
  online.delete(userId);
  io.emit('presence:update', { userId, online: false });
  affected.forEach(uid => io.to(roomForUser(uid)).emit('conversation:new', { deleted: true }));
});
