import multer from 'multer';
import { config } from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.verificationMaxFileMb * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(ApiError.badRequest('Only PDF, Word, text, JPEG, and PNG documents are accepted'));
    return callback(null, true);
  },
});

export const uploadVerificationDocuments = upload.array('documents', 3);

const cvMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.cvMaxFileMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!cvMimeTypes.has(file.mimetype)) {
      return callback(ApiError.badRequest('Only PDF, DOCX, and TXT CV files are accepted'));
    }
    return callback(null, true);
  },
});

export const uploadCvDocument = cvUpload.single('document');

const avatarMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.avatarMaxFileMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!avatarMimeTypes.has(file.mimetype)) {
      return callback(ApiError.badRequest('Only JPEG, PNG, and WebP profile photos are accepted'));
    }
    return callback(null, true);
  },
});

export const uploadAvatarImage = avatarUpload.single('image');

export function handleUploadError(error, _req, _res, next) {
  if (!error) return next();
  if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `Each document must be ${config.storage.verificationMaxFileMb} MB or smaller`, 'FILE_TOO_LARGE'));
  if (error.code === 'LIMIT_FILE_COUNT') return next(ApiError.badRequest('Attach at most three documents'));
  if (error instanceof multer.MulterError) return next(ApiError.badRequest('Invalid document upload'));
  return next(error);
}

export function handleCvUploadError(error, _req, _res, next) {
  if (!error) return next();
  if (error.code === 'LIMIT_FILE_SIZE') {
    return next(new ApiError(413, `CV must be ${config.storage.cvMaxFileMb} MB or smaller`, 'FILE_TOO_LARGE'));
  }
  if (error instanceof multer.MulterError) return next(ApiError.badRequest('Invalid CV upload'));
  return next(error);
}

export function handleAvatarUploadError(error, _req, _res, next) {
  if (!error) return next();
  if (error.code === 'LIMIT_FILE_SIZE') {
    return next(new ApiError(413, `Profile photo must be ${config.storage.avatarMaxFileMb} MB or smaller`, 'FILE_TOO_LARGE'));
  }
  if (error instanceof multer.MulterError) return next(ApiError.badRequest('Invalid profile photo upload'));
  return next(error);
}
