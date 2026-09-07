import { ApiError } from '../utils/ApiError.js';

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'Route not found', 'NOT_FOUND'));
}

export function errorHandler(error, _req, res, _next) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({ success: false, message: 'Invalid request data', error: { code: 'VALIDATION_ERROR' } });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ success: false, message: 'Email is already registered', error: { code: 'CONFLICT' } });
  }

  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof ApiError ? error.message : 'An unexpected server error occurred';
  return res.status(status).json({ success: false, message, error: { code } });
}
