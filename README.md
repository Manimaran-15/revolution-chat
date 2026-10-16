# Revolution Chat

A polished, mobile-first final-year real-time chat application inspired by the supplied project brief and reference design.

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Real-time: Socket.IO over WebSocket with reconnect/offline recovery
- Database: SQLite for local development; schema is intentionally portable to PostgreSQL
- Auth: Argon2 password hashing + short-lived JWT access token
- Validation: Zod
- Security: Helmet, CORS allow-list, rate limiting, authorization checks, upload validation, size limits

## Implemented
- Signup / login / logout
- JWT-protected API and authenticated Socket.IO handshake
- One-to-one private messaging
- Group creation and group messaging
- Persistent message history with cursor pagination
- Online / offline presence and typing indicators
- File, image and video uploads with previews
- Voice messages using MediaRecorder when supported
- In-app notifications and browser notification permission
- Emoji picker and message reactions
- User profile and settings panel
- Responsive desktop + tablet + phone UI
- WebRTC video-call foundation UI (signaling hooks are ready; production TURN infrastructure is still required)
- Reconnect logic and queued offline text messages
- Input validation, message length limits, rate limits, upload limits, security headers and authorization
- Database indexes for common chat queries
- Automated backend tests for input validation (vitest). API/socket integration tests are not included yet

## Quick start in VS Code

### 1. Requirements
Node.js 20+ and npm 10+ are recommended.

### 2. Install
```bash
npm install
```

### 3. Environment
```bash
cp server/.env.example server/.env
```
On Windows PowerShell:
```powershell
Copy-Item server/.env.example server/.env
```

The default local values are already suitable for development.

### 4. Database
```bash
npm run db:migrate
npm run db:seed
```
Seed creates demo users:
- `demo@revolution.chat` / `Password123!`
- `priya@revolution.chat` / `Password123!`
- `arun@revolution.chat` / `Password123!`

### 5. Run
```bash
npm run dev
```
Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

For same-Wi-Fi phone testing:
```bash
npm run dev:host
```
Find the PC IPv4 address with `ipconfig`, then open `http://YOUR_PC_IP:5173` on the phone while both devices are on the same Wi-Fi.

### 6. Test
```bash
npm test
npm run typecheck
npm run build
```

## Environment variables
See `server/.env.example`.

Important production values:
- `JWT_SECRET`: long random secret
- `CLIENT_ORIGIN`: exact HTTPS frontend origin
- `MAX_UPLOAD_BYTES`: upload limit
- `TRUST_PROXY`: enable only when behind a trusted reverse proxy

## API
Base URL: `/api`

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/users?search=`
- `GET /api/conversations`
- `POST /api/conversations/direct`
- `POST /api/groups`
- `GET /api/conversations/:id/messages?before=<messageId>&limit=40`
- `POST /api/messages`
- `POST /api/messages/:id/reactions`
- `POST /api/uploads`
- `PATCH /api/profile`

## WebSocket events
Client -> server:
- `conversation:join`
- `message:send`
- `typing:start`
- `typing:stop`
- `message:read`
- `reaction:toggle`

Server -> client:
- `message:new`
- `typing:update`
- `presence:update`
- `message:reaction`
- `notification:new`

The server authenticates the Socket.IO handshake using the same JWT access token as the API.

## Security notes
- Passwords are never stored in plaintext.
- JWT secrets are environment variables and are not committed.
- API input is validated with Zod.
- Upload MIME types and file size are checked server-side.
- Users can only read/write conversations they belong to.
- Rate limiting is applied to auth, messages and uploads.
- Helmet adds secure HTTP headers.
- CORS uses an explicit configured origin.

## Production deployment
For public internet deployment use:
1. HTTPS with a real domain.
2. Reverse proxy such as Nginx/Caddy.
3. Hosted PostgreSQL instead of local SQLite for multi-instance production.
4. S3-compatible object storage for uploads rather than local disk.
5. TURN server for reliable WebRTC calls across restrictive NATs.
6. Push notifications via FCM/Web Push if notifications must work while the app is closed.
7. Centralized logs/metrics and backups.

The application is optimized for low latency with WebSocket delivery, indexed queries, pagination, compact JSON payloads, reconnect handling and offline recovery. Network conditions can still affect real-world latency.
