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

export function handleUploadError(error, _req, _res, next) {
  if (!error) return next();
  if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `Each document must be ${config.storage.verificationMaxFileMb} MB or smaller`, 'FILE_TOO_LARGE'));
  if (error.code === 'LIMIT_FILE_COUNT') return next(ApiError.badRequest('Attach at most three documents'));
  if (error instanceof multer.MulterError) return next(ApiError.badRequest('Invalid document upload'));
  return next(error);
}
