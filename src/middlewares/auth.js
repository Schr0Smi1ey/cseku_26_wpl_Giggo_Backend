import { ApiError } from '../utils/ApiError.js';
import { syncSupabaseUser, verifySupabaseAccessToken } from '../services/supabase-auth.service.js';

export const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw ApiError.unauthorized('Missing access token');

    const identity = await verifySupabaseAccessToken(header.slice(7));
    req.user = await syncSupabaseUser(identity);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.some((role) => req.user.hasRole(role))) return next(ApiError.forbidden());
  return next();
};
