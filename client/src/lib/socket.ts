import { io, type Socket } from 'socket.io-client';
import { authToken } from './api';
let socket: Socket | null = null;
export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, { autoConnect: false, auth: cb => cb({ token: authToken() }), transports: ['websocket','polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000 });
  }
  return socket;
}
export function connectSocket() { const s = getSocket(); if (!s.connected) s.connect(); return s; }
export function disconnectSocket() { socket?.disconnect(); }
