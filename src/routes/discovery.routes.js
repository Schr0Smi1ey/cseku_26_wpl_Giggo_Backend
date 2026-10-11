import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Job } from '../models/Job.js';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { Service } from '../models/Service.js';
import { Agency } from '../models/Agency.js';
import { DiscoveryPreference } from '../models/DiscoveryPreference.js';
import { requireAuth, requireRole, optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
const router = Router();
const kind = z.enum(['jobs', 'freelancers', 'services', 'agencies']);
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sid = (v) => String(v?._id || v);
const sources = { jobs: { model: Job, base: { status: 'open' }, owner: 'client', field: 'title', fields: { title: 1, skills: 1, budget: 1, category: 1, createdAt: 1 } }, freelancers: { model: FreelancerProfile, base: { visibility: 'public', onboardingCompleted: true }, owner: 'user', field: 'title', fields: { title: 1, skills: 1, hourlyRate: 1, location: 1, user: 1 } }, services: { model: Service, base: { status: 'published', available: true }, owner: 'owner', field: 'title', fields: { title: 1, category: 1, packages: 1, skills: 1 } }, agencies: { model: Agency, base: { visibility: 'public' }, owner: 'owner', field: 'name', fields: { name: 1, description: 1, skills: 1, country: 1 } } };
async function search(type, q, page, category) {
  const source = sources[type];
  const match = { ...source.base };
  if (q) match.$or = [{ [source.field]: { $regex: escape(q), $options: 'i' } }, { skills: { $regex: escape(q), $options: 'i' } }];
  if (category && type !== 'freelancers' && type !== 'agencies') match.category = category;
  const rows = await source.model.aggregate([{ $match: match }, { $lookup: { from: 'users', localField: source.owner, foreignField: '_id', as: 'person' } }, { $unwind: '$person' }, { $match: { 'person.status': 'active' } }, { $sort: { createdAt: -1, _id: -1 } }, { $facet: { items: [{ $skip: (page - 1) * 20 }, { $limit: 20 }, { $project: { ...source.fields, person: { _id: 1, name: 1, avatar: 1 } } }], count: [{ $count: 'total' }] } }]);
  const total = rows[0]?.count[0]?.total || 0;
  return { items: rows[0]?.items || [], total, page, pages: Math.ceil(total / 20) };
}
router.get('/search', optionalAuth, asyncHandler(async (req, res) => {
  const values = z.object({ kind: kind.default('jobs'), q: z.string().trim().max(100).default(''), category: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), record: z.enum(['true', 'false']).default('false') }).parse(req.query);
  const results = await search(values.kind, values.q, values.page, values.category);
  if (req.user && values.record === 'true' && values.q) {
    const preference = await DiscoveryPreference.findOne({ user: req.user._id });
    if (preference?.historyEnabled) await DiscoveryPreference.updateOne({ _id: preference._id }, { $push: { history: { $each: [{ query: values.q, kind: values.kind, at: new Date() }], $slice: -20 } } });
  }
  return ok(res, { ...results, kind: values.kind, suggestions: results.items.slice(0, 5).map((v) => v.title || v.name) });
}));
router.get('/matches/:id', requireAuth, requireRole('client'), asyncHandler(async (req, res) => {
  oid.parse(req.params.id);
  const job = await Job.findOne({ _id: req.params.id, client: req.user._id });
  if (!job) throw ApiError.notFound('Job not found');
  const requirements = [...new Set((job.skills || []).map((s) => s.toLowerCase()))];
  const candidates = await FreelancerProfile.aggregate([
    { $match: { visibility: 'public', onboardingCompleted: true, availability: { $ne: 'not_available' } } },
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'person' } }, { $unwind: '$person' }, { $match: { 'person.status': 'active' } },
    { $set: { matchedSkills: { $setIntersection: [requirements, { $map: { input: '$skills', as: 'skill', in: { $toLower: '$$skill' } } }] }, missingSkills: { $setDifference: [requirements, { $map: { input: '$skills', as: 'skill', in: { $toLower: '$$skill' } } }] } } },
    { $set: { matchedCount: { $size: '$matchedSkills' } } }, { $sort: { matchedCount: -1, _id: 1 } }, { $limit: 50 },
    { $lookup: { from: 'reviews', let: { subject: '$user' }, pipeline: [{ $match: { $expr: { $eq: ['$subject', '$$subject'] }, hiddenAt: null } }, { $group: { _id: null, rating: { $avg: '$rating' }, count: { $sum: 1 } } }], as: 'reputation' } },
    { $project: { title: 1, user: 1, hourlyRate: 1, matchedSkills: 1, missingSkills: 1, matchedCount: 1, reputation: 1, person: { name: 1, avatar: 1 } } },
  ]);
  return ok(res, { advisoryOnly: true, method: 'Shared skills with verified review context; this does not reject applicants or make hiring decisions.', items: candidates.map((p) => ({ ...p, score: requirements.length ? Math.round(p.matchedCount / requirements.length * 100) : 0 })) });
}));
router.get('/preferences', requireAuth, asyncHandler(async (req, res) => {
  await DiscoveryPreference.updateOne({ user: req.user._id }, { $pull: { history: { at: { $lt: new Date(Date.now() - 30 * 86400000) } } } });
  const preferences = await DiscoveryPreference.findOneAndUpdate({ user: req.user._id }, { $setOnInsert: { user: req.user._id } }, { new: true, upsert: true });
  return ok(res, { preferences: { ...preferences.toObject(), history: preferences.history.filter((h) => h.at > new Date(Date.now() - 30 * 86400000)) } });
}));
router.put('/preferences', requireAuth, validate(z.object({ locale: z.enum(['en-BD', 'en-US', 'en-GB', 'bn-BD']), timezone: z.string().max(80).refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }), region: z.string().regex(/^[A-Z]{2}$/), currency: z.enum(['BDT', 'USD', 'EUR', 'GBP']), historyEnabled: z.boolean(), recommendationsEnabled: z.boolean(), savedFreelancers: z.array(oid).max(100), savedSearches: z.array(z.object({ name: z.string().trim().min(1).max(80), query: z.string().trim().max(100), kind }).strict()).max(30) }).strict()), asyncHandler(async (req, res) => {
  const ids = [...new Set(req.body.savedFreelancers)];
  if (await FreelancerProfile.countDocuments({ user: mongoose.trusted({ $in: ids }), visibility: 'public' }) !== ids.length) throw ApiError.badRequest('Save only public freelancer profiles');
  const preferences = await DiscoveryPreference.findOneAndUpdate({ user: req.user._id }, { $set: { ...req.body, savedFreelancers: ids, ...(!req.body.historyEnabled ? { history: [] } : {}) } }, { new: true, upsert: true });
  return ok(res, { preferences });
}));
router.delete('/history', requireAuth, asyncHandler(async (req, res) => { await DiscoveryPreference.updateOne({ user: req.user._id }, { history: [] }); return ok(res, { cleared: true }); }));
router.get('/recommendations', requireAuth, asyncHandler(async (req, res) => {
  const preference = await DiscoveryPreference.findOne({ user: req.user._id });
  if (preference?.recommendationsEnabled === false) return ok(res, { items: [] });
  const profile = await FreelancerProfile.findOne({ user: req.user._id }).select('skills');
  const skill = profile?.skills[0] || '';
  return ok(res, { ...await search('jobs', skill, 1), explanation: skill ? `Jobs mentioning your saved skill: ${skill}` : 'Recent public jobs; add profile skills for recommendations.' });
}));
export default router;
