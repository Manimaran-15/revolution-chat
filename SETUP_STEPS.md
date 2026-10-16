# Revolution Chat — step-by-step in VS Code

> Use **Node.js 20 or 22 (LTS)**. Newer/older Node versions can fail to install the native
> packages `argon2` and `better-sqlite3`. Check with `node -v`.

## Step 1 — Open the project
VS Code → **File ▸ Open Folder…** → choose the `RevolutionChat` folder.
Open the terminal: **Terminal ▸ New Terminal** (shortcut `Ctrl + ~`).

## Step 2 — Install + create `.env` + seed demo users (one command)
```bash
npm run setup
# npm install        -> downloads packages for client + server (workspaces)
# copy .env.example  -> creates server/.env (only if it does not exist yet)
# db:seed            -> creates the SQLite DB and 3 demo users
```
Edit `server/.env` and set a long random `JWT_SECRET`.

## Step 3 — Run in development (laptop)
```bash
npm run dev
# CLIENT (blue)  -> http://localhost:5173   <- open this in the browser
# SERVER (green) -> http://localhost:5174   (API + Socket.IO)
```
Log in: `demo@revolution.chat` / `Password123!`
Open a second browser window (Incognito) and log in as `priya@revolution.chat`
to watch real-time messages, typing and online dots.

## Step 4 — Test on your phone (same Wi-Fi only)
```bash
npm run dev:host
ipconfig            # Windows: find "IPv4 Address", e.g. 192.168.1.10   (Mac/Linux: ifconfig)
# On the phone browser open: http://192.168.1.10:5173
```
Note: browsers block the **microphone** on plain `http://` addresses, so voice notes
need the HTTPS method in Step 5.

## Step 5 — Any network (home Wi-Fi, 4G/5G, friends elsewhere)
The server now serves the built app itself, so **one public URL** is enough.
```bash
npm run build                  # builds client/dist (and compiles the server)
# in server/.env set:  TRUST_PROXY=true   and   ALLOW_ANY_ORIGIN=true
npm run start                  # app + API + sockets all on http://localhost:5174
```
In a **second terminal**, expose it with a free tunnel (no account needed):
```bash
cloudflared tunnel --url http://localhost:5174
# prints  https://something-random.trycloudflare.com   <- share this link
```
(or `ngrok http 5174`). Anyone, on any network, can open that HTTPS link;
microphone and notifications work because it is HTTPS. The link works while your
PC and the two terminals stay running.

For a permanent link, deploy the same repo to Render/Railway/a VPS:
build command `npm install && npm run build`, start command `npm run start`,
and add a persistent disk for `server/data` and `server/uploads`.

## Step 6 — Checks
```bash
npm test            # validation unit tests
npm run typecheck   # TypeScript check, client + server
npm run build       # production build
```

## Troubleshooting
| Problem | Fix |
|---|---|
| `argon2` / `better-sqlite3` install error | Use Node 20 or 22 LTS, then delete `node_modules` and run `npm install` again |
| Port 5173/5174 busy | Close old terminals, or change `PORT` in `server/.env` and the proxy target in `client/vite.config.ts` |
| Blank page after `npm run start` | Run `npm run build` first |
| Phone cannot connect (Wi-Fi) | Allow Node in Windows Firewall (Private network); same Wi-Fi; use the PC's IPv4 |
| Login rate-limited while tunnelling | Set `TRUST_PROXY=true` in `server/.env` |
