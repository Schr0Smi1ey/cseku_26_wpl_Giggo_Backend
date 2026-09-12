import { Job } from '../models/Job.js';
import { SavedJob } from '../models/SavedJob.js';
import { ApiError } from '../utils/ApiError.js';

const clientSelect = 'name role status';
const paginate = async (query, count, { page = 1, limit = 12 }) => { const [items, total] = await Promise.all([query.skip((page - 1) * limit).limit(limit), count]); return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }; };
async function owned(user, id) { const job = await Job.findById(id); if (!job) throw ApiError.notFound('Job not found'); if (String(job.client) !== String(user._id)) throw ApiError.forbidden('You do not own this job'); return job; }
export const jobService = {
  create: (user, data) => Job.create({ ...data, client: user._id }),
  async list(filters) { const where = { status: 'open' }; if (filters.category) where.category = filters.category; if (filters.budgetType) where['budget.type'] = filters.budgetType; if (filters.experienceLevel) where.experienceLevel = filters.experienceLevel; if (filters.duration) where.duration = filters.duration; if (filters.q) where.$text = { $search: filters.q }; const sort = filters.q ? { score: { $meta: 'textScore' } } : filters.sort === 'budget_asc' ? { 'budget.max': 1 } : filters.sort === 'budget_desc' ? { 'budget.max': -1 } : { createdAt: -1 }; return paginate(Job.find(where).populate('client', clientSelect).sort(sort), Job.countDocuments(where), filters); },
  async get(user, id) { const job = await Job.findById(id).populate('client', clientSelect); if (!job || (job.status !== 'open' && (!user || String(job.client._id) !== String(user._id)))) throw ApiError.notFound('Job not found'); return job; },
  async mine(user, filters) { const where = { client: user._id, ...(filters.status ? { status: filters.status } : {}) }; return paginate(Job.find(where).sort({ createdAt: -1 }), Job.countDocuments(where), filters); },
  async update(user, id, patch) { const job = await owned(user, id); Object.assign(job, patch); if (patch.budget) job.budget = { ...job.budget.toObject(), ...patch.budget }; await job.save(); return job; },
  async remove(user, id) { const job = await owned(user, id); await Promise.all([job.deleteOne(), SavedJob.deleteMany({ job: job._id })]); return { deleted: true }; },
  async save(user, id) { const job = await Job.findOne({ _id: id, status: 'open' }); if (!job) throw ApiError.notFound('Job not found'); const existing = await SavedJob.findOne({ user: user._id, job: id }); if (!existing) { await SavedJob.create({ user: user._id, job: id }); await Job.updateOne({ _id: id }, { $inc: { savedCount: 1 } }); } return { saved: true }; },
  async unsave(user, id) { const removed = await SavedJob.findOneAndDelete({ user: user._id, job: id }); if (removed) await Job.updateOne({ _id: id, savedCount: { $gt: 0 } }, { $inc: { savedCount: -1 } }); return { saved: false }; },
  async saved(user, filters) { const where = { user: user._id }; const rows = await SavedJob.find(where).sort({ createdAt: -1 }).skip(((filters.page || 1) - 1) * (filters.limit || 20)).limit(filters.limit || 20).populate({ path: 'job', populate: { path: 'client', select: clientSelect } }); const total = await SavedJob.countDocuments(where); const items = rows.map((row) => row.job).filter(Boolean); return { items, pagination: { page: filters.page || 1, limit: filters.limit || 20, total, totalPages: Math.max(1, Math.ceil(total / (filters.limit || 20))) } }; },
};
