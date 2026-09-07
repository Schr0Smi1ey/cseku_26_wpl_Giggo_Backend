import { config } from '../config/index.js';
import { authService } from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
};

function sendSession(res, session, status = 200) {
  const { refreshToken, ...data } = session;
  res.cookie('refreshToken', refreshToken, cookieOptions);
  return ok(res, data, 'Authentication successful', status);
}

export const authController = {
  register: asyncHandler(async (req, res) => sendSession(res, await authService.register(req.body), 201)),
  login: asyncHandler(async (req, res) => sendSession(res, await authService.login(req.body))),
  refresh: asyncHandler(async (req, res) => sendSession(res, await authService.refresh(req.cookies.refreshToken))),
  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.cookies.refreshToken);
    res.clearCookie('refreshToken', { ...cookieOptions, maxAge: undefined });
    return ok(res, null, 'Logged out');
  }),
  me: asyncHandler(async (req, res) => ok(res, { user: req.user.toJSON() })),
};
