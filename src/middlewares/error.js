import { ApiError } from '../utils/ApiError.js';

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'Route not found', 'NOT_FOUND'));
}

export function errorHandler(error, _req, res, _next) {
  if (error?.name === 'ValidationError') {
    const fields = Object.keys(error.errors || {});
    console.error('Account validation failed for fields:', fields.join(', '));
    return res.status(400).json({ success: false, message: 'Account information could not be saved. Please check your profile name and account details.', error: { code: 'VALIDATION_ERROR' } });
  }
  if (error?.name === 'ZodError') {
    return res.status(400).json({ success: false, message: 'Invalid request data', error: { code: 'VALIDATION_ERROR' } });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ success: false, message: 'Email is already registered', error: { code: 'CONFLICT' } });
  }

  const status = error instanceof ApiError ? error.status : 500;
  if (status === 500) console.error('API request failed', { name: error?.name, code: error?.code, codeName: error?.codeName });
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof ApiError ? error.message : 'An unexpected server error occurred';
  return res.status(status).json({ success: false, message, error: { code } });
}
