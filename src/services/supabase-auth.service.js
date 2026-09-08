import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config/index.js';
import { ROLES, User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

const jwksByUrl = new Map();
let testTokenVerifier;

function supabaseIssuer() {
  if (!config.supabase.url) return '';
  return `${config.supabase.url}/auth/v1`;
}

function normalizeString(value, maxLength = 100) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function requestedRole(metadata) {
  const role = metadata?.signup_role;
  return role === ROLES.CLIENT || role === ROLES.FREELANCER ? role : ROLES.FREELANCER;
}

function identityFromClaims(payload) {
  const supabaseUserId = normalizeString(payload.sub, 128);
  const email = normalizeString(payload.email, 254).toLowerCase();
  const metadata = payload.user_metadata && typeof payload.user_metadata === 'object' ? payload.user_metadata : {};

  if (!supabaseUserId || !email) throw ApiError.unauthorized('Invalid Supabase access token');
  // Supabase access-token JWTs do not carry email_confirmed_at. Email confirmation is
  // enforced by the Supabase Email provider before it creates a password session.

  return {
    supabaseUserId,
    email,
    name: normalizeString(metadata.name, 100) || email.split('@')[0],
    role: requestedRole(metadata),
  };
}

function jwksFor(url) {
  const jwksUrl = `${url}/auth/v1/.well-known/jwks.json`;
  if (!jwksByUrl.has(jwksUrl)) jwksByUrl.set(jwksUrl, createRemoteJWKSet(new URL(jwksUrl)));
  return jwksByUrl.get(jwksUrl);
}

export function setSupabaseTokenVerifierForTests(verifier) {
  if (!config.isTest) throw new Error('Test token overrides are unavailable outside the test environment');
  testTokenVerifier = verifier;
}

export async function verifySupabaseAccessToken(token) {
  try {
    if (config.isTest && testTokenVerifier) return identityFromClaims(await testTokenVerifier(token));
    if (!config.supabase.url) throw new ApiError(503, 'Supabase authentication is not configured', 'AUTH_CONFIGURATION_ERROR');

    const { payload } = await jwtVerify(token, jwksFor(config.supabase.url), {
      issuer: supabaseIssuer(),
      audience: 'authenticated',
    });
    return identityFromClaims(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}

export async function syncSupabaseUser(identity) {
  let user = await User.findOne({ supabaseUserId: identity.supabaseUserId });
  if (!user) {
    user = await User.findOne({ email: identity.email });
    if (user?.supabaseUserId && user.supabaseUserId !== identity.supabaseUserId) {
      throw ApiError.conflict('This email is already linked to another account');
    }
  }

  if (!user) {
    user = new User({
      name: identity.name,
      email: identity.email,
      role: identity.role,
      roles: [identity.role],
      authProvider: 'supabase',
      supabaseUserId: identity.supabaseUserId,
      emailVerified: true,
    });
  } else {
    user.supabaseUserId = identity.supabaseUserId;
    user.authProvider = 'supabase';
    user.emailVerified = true;
  }

  if (user.status !== 'active') throw ApiError.unauthorized('Account is unavailable');
  if (!user.lastActiveAt || Date.now() - user.lastActiveAt.getTime() > 5 * 60 * 1000) user.lastActiveAt = new Date();
  await user.save();
  return user;
}
