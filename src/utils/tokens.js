import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export function signAccessToken(user) {
  return jwt.sign(
    { role: user.role, roles: user.roles },
    config.jwt.accessSecret,
    { subject: String(user._id), expiresIn: config.jwt.accessTtl },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

export function createRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
