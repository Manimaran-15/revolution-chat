# Revolution Chat — Feature Checklist

## Completed in this repository
- [x] Signup / login / logout
- [x] Argon2 password hashing
- [x] JWT authentication for API and Socket.IO
- [x] One-to-one conversations
- [x] Group creation and group messaging
- [x] Persistent SQLite chat history
- [x] Cursor pagination API
- [x] Online / offline presence
- [x] Typing indicators
- [x] Image / video / file upload and previews
- [x] Voice-message recording with MediaRecorder
- [x] In-app and browser notification support
- [x] Emoji picker
- [x] Message reactions
- [x] Profile editing
- [x] Responsive mobile / laptop / desktop layout
- [x] Reconnect and browser online/offline handling
- [x] Server-side input validation
- [x] Upload MIME and size validation
- [x] Auth/message rate limiting
- [x] Helmet, CORS and authorization checks
- [x] Database indexes
- [x] API and WebSocket documentation
- [x] GitHub-safe environment variable template
- [x] Backend validation tests

## Production work still required
- [ ] PostgreSQL migration for multi-instance deployment
- [ ] S3-compatible object storage
- [ ] Full TURN/STUN infrastructure and production WebRTC signaling lifecycle
- [ ] FCM/Web Push service worker notifications while the app is closed
- [ ] End-to-end message encryption if required by the project scope
- [ ] CI pipeline and coverage gate
- [ ] Observability, backups and abuse monitoring
- [ ] HTTPS domain + reverse proxy
