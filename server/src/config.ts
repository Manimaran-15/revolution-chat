import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 5174),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  allowedOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map(x => x.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  databaseFile: path.resolve(process.cwd(), process.env.DATABASE_FILE ?? './data/revolution-chat.db'),
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024),
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Auth uses a Bearer token (not cookies), so this is low-risk; handy for tunnels and demos.
  allowAnyOrigin: process.env.ALLOW_ANY_ORIGIN === 'true'
};
