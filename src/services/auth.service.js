import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { createRefreshToken, hashToken, signAccessToken } from '../utils/tokens.js';

const refreshDurationMs = config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000;

async function issueSession(user, family = crypto.randomUUID()) {
  const { raw, hash } = createRefreshToken();
  await RefreshToken.create({
    user: user._id,
    tokenHash: hash,
    family,
    expiresAt: new Date(Date.now() + refreshDurationMs),
  });
  return { accessToken: signAccessToken(user), refreshToken: raw, user: user.toJSON() };
}

export const authService = {
  async register({ name, email, password, role }) {
    const normalizedEmail = email.toLowerCase();
    if (await User.exists({ email: normalizedEmail })) throw ApiError.conflict('Email is already registered');

    const user = new User({ name, email: normalizedEmail, role, roles: [role] });
    await user.setPassword(password);
    await user.save();
    return issueSession(user);
  },

  async login({ email, password }) {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await user.comparePassword(password))) throw ApiError.unauthorized('Invalid email or password');
    if (user.status !== 'active') throw ApiError.forbidden('Account is unavailable');

    user.lastActiveAt = new Date();
    await user.save();
    return issueSession(user);
  },

  async refresh(rawToken) {
    if (!rawToken) throw ApiError.unauthorized('Missing refresh token');

    const token = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
    if (!token || token.expiresAt <= new Date()) throw ApiError.unauthorized('Invalid or expired refresh token');

    if (token.revokedAt) {
      await RefreshToken.updateMany({ family: token.family, revokedAt: null }, { revokedAt: new Date() });
      throw ApiError.unauthorized('Refresh token reuse detected');
    }

    const user = await User.findById(token.user);
    if (!user || user.status !== 'active') throw ApiError.unauthorized('Account is unavailable');

    const { raw: nextRawToken, hash: nextTokenHash } = createRefreshToken();
    const now = new Date();
    const claimedToken = await RefreshToken.findOneAndUpdate(
      { _id: token._id, revokedAt: null },
      { revokedAt: now, replacedByHash: nextTokenHash },
      { new: true },
    );

    if (!claimedToken) {
      await RefreshToken.updateMany({ family: token.family, revokedAt: null }, { revokedAt: now });
      throw ApiError.unauthorized('Refresh token reuse detected');
    }

    await RefreshToken.create({
      user: user._id,
      tokenHash: nextTokenHash,
      family: token.family,
      expiresAt: new Date(Date.now() + refreshDurationMs),
    });

    return { accessToken: signAccessToken(user), refreshToken: nextRawToken, user: user.toJSON() };
  },

  async logout(rawToken) {
    if (!rawToken) return;
    await RefreshToken.updateOne({ tokenHash: hashToken(rawToken), revokedAt: null }, { revokedAt: new Date() });
  },
};
