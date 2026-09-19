import crypto from 'node:crypto';
import { analyzeCvText } from '../integrations/ai/index.js';
import { AIAnalysis } from '../models/AIAnalysis.js';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { config } from '../config/index.js';
import { extractCvText } from '../utils/cv-text.js';
import { ApiError } from '../utils/ApiError.js';

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function inputFromUploadedCv(userId) {
  const profile = await FreelancerProfile.findOne({ user: userId });
  if (!profile?.cv?.storageKey) throw ApiError.badRequest('Upload a CV or paste CV text before analysis');
  const text = await extractCvText(profile.cv.storageKey, profile.cv.mimeType);
  return { text, profile, source: { kind: 'cv_file', filename: profile.cv.filename } };
}

async function ownedAnalysis(userId, id) {
  const analysis = await AIAnalysis.findOne({ _id: id, user: userId });
  if (!analysis) throw ApiError.notFound('Analysis not found');
  return analysis;
}

async function enforceRetention(userId) {
  const keep = Math.max(1, config.ai.retention);
  const stale = await AIAnalysis.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip(keep)
    .select('_id');
  if (stale.length) await AIAnalysis.deleteMany({ _id: { $in: stale.map((item) => item._id) } });
}

export const aiService = {
  async analyzeCv(user, { text, force = false }) {
    let profile = await FreelancerProfile.findOne({ user: user._id });
    let source = { kind: 'text', filename: '' };
    let input = text?.trim();

    if (!input) ({ text: input, profile, source } = await inputFromUploadedCv(user._id));
    if (input.length < 20) throw ApiError.badRequest('CV text must contain at least 20 characters');

    const textHash = hash(input);
    if (!force) {
      const cached = await AIAnalysis.findOne({ user: user._id, textHash }).sort({ createdAt: -1 });
      if (cached) return cached;
    }

    const { provider, result } = await analyzeCvText(input, profile);
    const analysis = await AIAnalysis.create({ user: user._id, textHash, provider, source, result });
    await enforceRetention(user._id);
    return analysis;
  },

  latest(user) {
    return AIAnalysis.findOne({ user: user._id }).sort({ createdAt: -1 });
  },

  async list(user, { page = 1, limit = 20 }) {
    const filter = { user: user._id };
    const [items, total] = await Promise.all([
      AIAnalysis.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AIAnalysis.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  },

  get(user, id) {
    return ownedAnalysis(user._id, id);
  },

  async remove(user, id) {
    const analysis = await AIAnalysis.findOneAndDelete({ _id: id, user: user._id });
    if (!analysis) throw ApiError.notFound('Analysis not found');
    return { deleted: true };
  },

  async applySkills(user, id) {
    const analysis = await ownedAnalysis(user._id, id);
    const profile = await FreelancerProfile.findOne({ user: user._id });
    if (!profile) throw ApiError.badRequest('Create a freelancer profile first');

    const existing = new Set(profile.skills.map((skill) => skill.toLowerCase()));
    const capacity = Math.max(0, 30 - profile.skills.length);
    const added = analysis.result.suggestedSkills
      .filter((skill) => !existing.has(skill.toLowerCase()))
      .slice(0, capacity);
    profile.skills.push(...added);
    await profile.save();
    return { profile, added };
  },
};
