import mongoose from 'mongoose';
import { Contract } from '../models/Contract.js';
import { Conversation } from '../models/Conversation.js';
import { Job } from '../models/Job.js';
import { Message } from '../models/Message.js';
import { Milestone } from '../models/Milestone.js';
import { Notification } from '../models/Notification.js';
import { SavedJob } from '../models/SavedJob.js';
import { SavedMessage } from '../models/SavedMessage.js';
import { Proposal } from '../models/Proposal.js';
import { Project } from '../models/Project.js';
import { Offer } from '../models/Offer.js';
import { OfferMessage } from '../models/OfferMessage.js';
import { OfferRevision } from '../models/OfferRevision.js';
import { WorkSubmission } from '../models/WorkSubmission.js';
import { ApiError } from '../utils/ApiError.js';

const clientSelect = 'name avatar role status';
const paginate = async (query, count, { page = 1, limit = 12 }) => { const [items, total] = await Promise.all([query.skip((page - 1) * limit).limit(limit), count]); return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }; };
async function owned(user, id) { const job = await Job.findById(id); if (!job) throw ApiError.notFound('Job not found'); if (String(job.client) !== String(user._id)) throw ApiError.forbidden('You do not own this job'); return job; }

async function addFreelancerState(user, items) {
  if (!user?.hasRole('freelancer') || items.length === 0) return items;

  const jobIds = items.map((item) => item._id);
  const [proposals, followedJobs] = await Promise.all([
    Proposal.find({ freelancer: user._id, job: mongoose.trusted({ $in: jobIds }) }).select('job status').lean(),
    SavedJob.find({ user: user._id, job: mongoose.trusted({ $in: jobIds }) }).select('job').lean(),
  ]);
  const proposalByJob = new Map(proposals.map((proposal) => [String(proposal.job), proposal.status]));
  const followed = new Set(followedJobs.map((row) => String(row.job)));

  return items.map((item) => {
    const job = item.toObject();
    const proposalStatus = proposalByJob.get(String(item._id)) || null;
    return {
      ...job,
      viewerState: {
        applied: Boolean(proposalStatus && proposalStatus !== 'withdrawn'),
        proposalStatus,
        followed: followed.has(String(item._id)),
      },
    };
  });
}

export const jobService = {
  create: (user, data) => Job.create({ ...data, client: user._id }),
  async list(user, filters) {
    const where = {};
    if (filters.activity) {
      if (!user) throw ApiError.unauthorized('Sign in to filter your job activity');
      if (!user.hasRole('freelancer')) throw ApiError.forbidden('A freelancer account is required for job activity filters');
      const jobIds = filters.activity === 'applied'
        ? await Proposal.find({ freelancer: user._id, status: mongoose.trusted({ $ne: 'withdrawn' }) }).distinct('job')
        : await SavedJob.find({ user: user._id }).distinct('job');
      where._id = mongoose.trusted({ $in: jobIds });
    } else {
      where.status = 'open';
    }
    if (filters.category) where.category = filters.category;
    if (filters.budgetType) where['budget.type'] = filters.budgetType;
    if (filters.experienceLevel) where.experienceLevel = filters.experienceLevel;
    if (filters.duration) where.duration = filters.duration;
    if (filters.q) where.$text = { $search: filters.q };
    const sort = filters.q ? { score: { $meta: 'textScore' } } : filters.sort === 'budget_asc' ? { 'budget.max': 1 } : filters.sort === 'budget_desc' ? { 'budget.max': -1 } : { createdAt: -1 };
    const result = await paginate(Job.find(where).populate('client', clientSelect).sort(sort), Job.countDocuments(where), filters);
    return { ...result, items: await addFreelancerState(user, result.items) };
  },
  async get(user, id) {
    const job = await Job.findById(id).populate('client', clientSelect);
    if (!job) throw ApiError.notFound('Job not found');
    const isOwner = user && String(job.client._id) === String(user._id);
    if (job.status !== 'open' && !isOwner) {
      const [hasApplied, hasFollowed] = user
        ? await Promise.all([
          Proposal.exists({ job: job._id, freelancer: user._id }),
          SavedJob.exists({ job: job._id, user: user._id }),
        ])
        : [false, false];
      if (!hasApplied && !hasFollowed) throw ApiError.notFound('Job not found');
    }
    return job;
  },
  async mine(user, filters) { const where = { client: user._id, ...(filters.status ? { status: filters.status } : {}) }; return paginate(Job.find(where).sort({ createdAt: -1 }), Job.countDocuments(where), filters); },
  async update(user, id, patch) { const job = await owned(user, id); if (job.hiredProposal && patch.status && patch.status !== 'filled') throw ApiError.conflict('A filled job cannot be reopened before its accepted engagement is resolved'); Object.assign(job, patch); if (patch.budget) job.budget = { ...job.budget.toObject(), ...patch.budget }; await job.save(); return job; },
  async remove(user, id) {
    const job = await owned(user, id);
    if (job.hiredProposal) throw ApiError.conflict('A filled job cannot be deleted while it has an accepted offer');
    const [offerIds, proposalIds, contractIds, projectIds] = await Promise.all([
      Offer.find({ job: job._id }).distinct('_id'),
      Proposal.find({ job: job._id }).distinct('_id'),
      Contract.find({ job: job._id }).distinct('_id'),
      Project.find({ job: job._id }).distinct('_id'),
    ]);
    const conversationIds = await Conversation.find({ contextType: 'offer', contextId: mongoose.trusted({ $in: offerIds }) }).distinct('_id');
    const messageIds = await Message.find({ conversation: mongoose.trusted({ $in: conversationIds }) }).distinct('_id');
    await Promise.all([
      job.deleteOne(),
      SavedJob.deleteMany({ job: job._id }),
      SavedMessage.deleteMany({ message: mongoose.trusted({ $in: messageIds }) }),
      Message.deleteMany({ conversation: mongoose.trusted({ $in: conversationIds }) }),
      Conversation.deleteMany({ _id: mongoose.trusted({ $in: conversationIds }) }),
      Notification.deleteMany({ $or: [
        { entityType: 'offer', entityId: mongoose.trusted({ $in: offerIds }) },
        { entityType: 'proposal', entityId: mongoose.trusted({ $in: proposalIds }) },
        { entityType: 'contract', entityId: mongoose.trusted({ $in: contractIds }) },
        { entityType: 'project', entityId: mongoose.trusted({ $in: projectIds }) },
      ] }),
      WorkSubmission.deleteMany({ project: mongoose.trusted({ $in: projectIds }) }),
      Milestone.deleteMany({ project: mongoose.trusted({ $in: projectIds }) }),
      Contract.deleteMany({ job: job._id }),
      Project.deleteMany({ job: job._id }),
      Proposal.deleteMany({ job: job._id }),
      OfferMessage.deleteMany({ offer: mongoose.trusted({ $in: offerIds }) }),
      OfferRevision.deleteMany({ offer: mongoose.trusted({ $in: offerIds }) }),
      Offer.deleteMany({ job: job._id }),
    ]);
    return { deleted: true };
  },
  async save(user, id) { const job = await Job.findOne({ _id: id, status: 'open' }); if (!job) throw ApiError.notFound('Job not found'); const existing = await SavedJob.findOne({ user: user._id, job: id }); if (!existing) { await SavedJob.create({ user: user._id, job: id }); await Job.updateOne({ _id: id }, { $inc: { savedCount: 1 } }); } return { saved: true }; },
  async unsave(user, id) { const removed = await SavedJob.findOneAndDelete({ user: user._id, job: id }); if (removed) await Job.updateOne({ _id: id, savedCount: { $gt: 0 } }, { $inc: { savedCount: -1 } }); return { saved: false }; },
  async saved(user, filters) { const where = { user: user._id }; const rows = await SavedJob.find(where).sort({ createdAt: -1 }).skip(((filters.page || 1) - 1) * (filters.limit || 20)).limit(filters.limit || 20).populate({ path: 'job', populate: { path: 'client', select: clientSelect } }); const total = await SavedJob.countDocuments(where); const items = rows.map((row) => row.job).filter(Boolean); return { items, pagination: { page: filters.page || 1, limit: filters.limit || 20, total, totalPages: Math.max(1, Math.ceil(total / (filters.limit || 20))) } }; },
};
