import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ClientProfile } from '../models/ClientProfile.js';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

const freelancerFields = ['title', 'overview', 'category', 'hourlyRate', 'availability', 'skills', 'languages', 'location', 'links', 'education', 'experience', 'certifications', 'portfolio', 'visibility'];
const clientFields = ['companyName', 'companyDescription', 'industry', 'website', 'teamSize', 'location'];

function profileTypeFor(user) {
  if (user.role === ROLES.FREELANCER) return 'freelancer';
  if (user.role === ROLES.CLIENT) return 'client';
  throw ApiError.forbidden('Profiles are available only to freelancers and clients');
}

function modelFor(type) {
  return type === 'freelancer' ? FreelancerProfile : ClientProfile;
}

function fieldsFor(type) {
  return type === 'freelancer' ? freelancerFields : clientFields;
}

async function getOrCreate(user) {
  const type = profileTypeFor(user);
  const Model = modelFor(type);
  let profile = await Model.findOne({ user: user._id });
  if (!profile) {
    try {
      profile = await Model.create({ user: user._id });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      profile = await Model.findOne({ user: user._id });
    }
  }
  return { profile, type };
}

function applyPatch(profile, type, patch) {
  for (const field of fieldsFor(type)) {
    if (patch[field] === undefined) continue;
    if (field === 'location' || field === 'links') {
      profile.set(field, { ...(profile.get(field)?.toObject?.() || profile.get(field) || {}), ...patch[field] });
    } else {
      profile.set(field, patch[field]);
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const profileService = {
  async getMine(user) {
    return getOrCreate(user);
  },

  async updateMine(user, patch) {
    const { profile, type } = await getOrCreate(user);
    applyPatch(profile, type, patch);
    await profile.save();
    return { profile, type };
  },

  async completeOnboarding(user, patch) {
    const { profile, type } = await getOrCreate(user);
    applyPatch(profile, type, patch);
    profile.onboardingCompleted = true;
    if (type === 'freelancer' && patch.visibility === undefined) profile.visibility = 'public';
    await profile.save();
    return { profile, type };
  },

  async uploadCv(user, file) {
    if (profileTypeFor(user) !== 'freelancer') throw ApiError.forbidden('Only freelancers can upload a CV');
    if (!file?.buffer) throw ApiError.badRequest('Attach a CV document');
    const { profile } = await getOrCreate(user);
    const root = process.env.UPLOAD_DIR || path.resolve('.runtime', 'cvs');
    const extension = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const key = `${user._id}-${crypto.randomUUID()}${extension}`;
    await fs.mkdir(root, { recursive: true });
    const storageKey = path.join(root, key);
    await fs.writeFile(storageKey, file.buffer, { flag: 'wx' });
    if (profile.cv?.storageKey) await fs.unlink(profile.cv.storageKey).catch(() => {});
    profile.cv = { filename: path.basename(file.originalname || 'cv'), mimeType: file.mimetype, size: file.size, storageKey, uploadedAt: new Date() };
    await profile.save();
    return { profile, type: 'freelancer' };
  },

  async removeCv(user) {
    if (profileTypeFor(user) !== 'freelancer') throw ApiError.forbidden('Only freelancers can remove a CV');
    const { profile } = await getOrCreate(user);
    if (profile.cv?.storageKey) await fs.unlink(profile.cv.storageKey).catch(() => {});
    profile.cv = { filename: '', mimeType: '', size: 0, storageKey: '', uploadedAt: null };
    await profile.save();
    return { profile, type: 'freelancer' };
  },

  async getPublicFreelancer(userId) {
    if (!mongoose.isValidObjectId(userId)) throw ApiError.notFound('Freelancer profile not found');
    const profile = await FreelancerProfile.findOne({ user: userId, visibility: 'public', onboardingCompleted: true })
      .populate('user', 'name role status');
    if (!profile || !profile.user || profile.user.status !== 'active') throw ApiError.notFound('Freelancer profile not found');
    return profile;
  },

  async listPublicFreelancers({ search, category, availability, sort = 'recent', page = 1, limit = 12 }) {
    const filter = { visibility: 'public', onboardingCompleted: true };
    if (category) filter.category = category;
    if (availability) filter.availability = availability;
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ title: regex }, { overview: regex }, { skills: regex }];
    }
    const sortBy = {
      recent: { updatedAt: -1 },
      rate_asc: { hourlyRate: 1 },
      rate_desc: { hourlyRate: -1 },
    }[sort] || { updatedAt: -1 };
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      FreelancerProfile.find(filter).populate('user', 'name role status').sort(sortBy).skip(skip).limit(limit),
      FreelancerProfile.countDocuments(filter),
    ]);
    return { items: items.filter((profile) => profile.user?.status === 'active'), page, limit, total };
  },
};
