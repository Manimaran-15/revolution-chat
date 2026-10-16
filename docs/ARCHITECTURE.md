# Architecture

```text
Browser (React + Vite + TypeScript)
        |
        | HTTPS REST / WebSocket
        v
Node.js + Express + Socket.IO
        |
        +---- Auth / validation / authorization
        +---- Presence / typing / notifications
        +---- Upload validation + local storage
        |
        v
SQLite (local development)
        |
        +---- users
        +---- conversations
        +---- conversation_members
        +---- messages
        +---- reactions
        +---- read_receipts
```

The code keeps the persistence layer simple enough to port to PostgreSQL. For public deployment, replace local uploads with object storage and run the API behind an HTTPS reverse proxy.
