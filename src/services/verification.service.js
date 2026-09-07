import crypto from 'node:crypto';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { authService } from './auth.service.js';
import { approvedTypesFor, deriveBadges, syncUserBadges } from './verification.badges.js';
import { readVerificationDocument, removeVerificationDocument, storeVerificationDocument } from './verification.storage.service.js';

const phoneCodes = new Map();
const phoneCodeTtlMs = 10 * 60 * 1000;
const maxPhoneAttempts = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export const verificationService = {
  async getStatus(user) {
    const [approvedTypes, requests] = await Promise.all([
      approvedTypesFor(user._id),
      VerificationRequest.find({ user: user._id }).sort({ createdAt: -1 }).limit(20),
    ]);
    const derived = deriveBadges(user, approvedTypes);
    return {
      emailVerified: !!user.emailVerified,
      phoneVerified: !!user.phoneVerified,
      phone: user.phone || '',
      verificationState: derived.verificationState,
      badges: derived.badges,
      requests: requests.map((request) => request.toJSON()),
    };
  },

  async resendEmail(user) {
    return authService.resendEmailVerification(user);
  },

  async sendPhoneCode(user, { phone } = {}) {
    const number = (phone || user.phone || '').trim();
    if (!number) throw ApiError.badRequest('A phone number is required');
    const code = generateCode();
    phoneCodes.set(String(user._id), {
      codeHash: hashCode(code),
      phone: number,
      expiresAt: Date.now() + phoneCodeTtlMs,
      attempts: 0,
    });
    return { sent: true, devCode: process.env.NODE_ENV === 'production' ? undefined : code };
  },

  async verifyPhoneCode(user, { code }) {
    const key = String(user._id);
    const entry = phoneCodes.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      phoneCodes.delete(key);
      throw ApiError.badRequest('No active code — request a new one');
    }
    if (entry.attempts >= maxPhoneAttempts) {
      phoneCodes.delete(key);
      throw ApiError.badRequest('Too many attempts — request a new code');
    }
    if (hashCode(code) !== entry.codeHash) {
      entry.attempts += 1;
      throw ApiError.badRequest('Incorrect code');
    }
    phoneCodes.delete(key);
    user.phone = entry.phone;
    user.phoneVerified = true;
    await user.save();
    await syncUserBadges(user._id);
    return { phoneVerified: true };
  },

  async submitRequest(user, { type, note }, files = []) {
    if (!files.length) throw ApiError.badRequest('Attach at least one supporting document');
    const existing = await VerificationRequest.exists({ user: user._id, type, status: 'pending' });
    if (existing) throw ApiError.conflict(`You already have a pending ${type} request`);

    const documents = [];
    try {
      for (const file of files) {
        const storedPath = await storeVerificationDocument(file);
        documents.push({ filename: file.originalname, mimeType: file.mimetype, path: storedPath });
      }
      return await VerificationRequest.create({ user: user._id, type, note: note || '', documents });
    } catch (error) {
      await Promise.all(documents.map((document) => removeVerificationDocument(document.path)));
      throw error;
    }
  },

  async myRequests(user) {
    return VerificationRequest.find({ user: user._id }).sort({ createdAt: -1 });
  },

  async cancelRequest(user, id) {
    const request = await VerificationRequest.findOneAndUpdate(
      { _id: id, user: user._id, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).select('+documents.path');
    if (!request) {
      const exists = await VerificationRequest.exists({ _id: id, user: user._id });
      if (!exists) throw ApiError.notFound('Verification request not found');
      throw ApiError.badRequest('Only pending requests can be cancelled');
    }
    await Promise.all(request.documents.map((document) => removeVerificationDocument(document.path)));
    return request;
  },

  async listQueue({ status = 'pending', type, page = 1, limit = 20 }) {
    const filter = { status };
    if (type) filter.type = type;
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      VerificationRequest.find(filter).populate('user', 'name email role').sort({ createdAt: 1 }).skip(skip).limit(limit),
      VerificationRequest.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  },

  async decide(admin, id, { decision, reviewNote }) {
    const status = decision === 'approve' ? 'approved' : 'rejected';
    const request = await VerificationRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status, reviewNote: reviewNote || '', reviewedBy: admin._id, reviewedAt: new Date() } },
      { new: true },
    );
    if (!request) {
      const exists = await VerificationRequest.exists({ _id: id });
      if (!exists) throw ApiError.notFound('Verification request not found');
      throw ApiError.badRequest('Verification request has already been reviewed');
    }
    await syncUserBadges(request.user);
    return request;
  },

  async adminDocument(id, index) {
    const request = await VerificationRequest.findById(id).select('+documents.path');
    if (!request) throw ApiError.notFound('Verification request not found');
    const document = request.documents[index];
    if (!document) throw ApiError.notFound('Document not found');
    return { document, path: await readVerificationDocument(document.path) };
  },
};

export function resetVerificationTestState() {
  phoneCodes.clear();
}
