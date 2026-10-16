import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export type AuthUser = { id: string; email: string; name: string };

export async function hashPassword(password: string) { return argon2.hash(password); }
export async function verifyPassword(hash: string, password: string) { return argon2.verify(hash, password); }
export function signToken(user: AuthUser) { return jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }); }
export function verifyToken(token: string) { return jwt.verify(token, config.jwtSecret) as AuthUser & jwt.JwtPayload; }
