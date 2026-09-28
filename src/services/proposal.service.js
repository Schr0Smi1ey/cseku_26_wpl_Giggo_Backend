import mongoose from 'mongoose';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { Job } from '../models/Job.js';
import { Offer } from '../models/Offer.js';
import { Proposal } from '../models/Proposal.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from './notification.service.js';

const ACTIVE_STATUSES = ['submitted', 'shortlisted'];
const JOB_SELECT = 'title status category budget client experienceLevel duration createdAt';
const USER_SELECT = 'name avatar role status';
const WRITABLE_FIELDS = ['coverLetter', 'bid', 'estimatedDays', 'milestones', 'aiAssisted'];

function applyPatch(proposal, patch) {
  for (const field of WRITABLE_FIELDS) {
    if (patch[field] === undefined) continue;
    proposal[field] = field === 'bid'
      ? { ...(proposal.bid?.toObject?.() || proposal.bid || {}), ...patch.bid }
      : patch[field];
  }
}

async function ownedProposal(user, id) {
  const proposal = await Proposal.findById(id);
  if (!proposal || String(proposal.freelancer) !== String(user._id)) throw ApiError.notFound('Proposal not found');
  return proposal;
}

async function receivedProposal(user, id) {
  const proposal = await Proposal.findById(id);
  if (!proposal || String(proposal.client) !== String(user._id)) throw ApiError.notFound('Proposal not found');
  return proposal;
}

async function profileSnippets(userIds) {
  if (!userIds.length) return {};
  const profiles = await FreelancerProfile.find({ user: mongoose.trusted({ $in: userIds }) })
    .select('user title hourlyRate skills badges completeness verificationState');
  return Object.fromEntries(profiles.map((profile) => [String(profile.user), profile.toJSON()]));
}

async function offerSnippets(proposalIds) {
  if (!proposalIds.length) return {};
  const offers = await Offer.find({ proposal: mongoose.trusted({ $in: proposalIds }) })
    .sort({ createdAt: -1 })
    .select('proposal status revision changeRequest expiresAt sentAt createdAt updatedAt')
    .lean();
  const byProposal = {};
  for (const offer of offers) {
    const proposalId = String(offer.proposal);
    if (!byProposal[proposalId]) byProposal[proposalId] = offer;
  }
  return byProposal;
}

function pageData(items, total, page, limit) {
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export const proposalService = {
  async create(user, { job: jobId, ...data }) {
    await Proposal.init();
    const job = await Job.findById(jobId);
    if (!job) throw ApiError.notFound('Job not found');
    if (String(job.client) === String(user._id)) throw ApiError.badRequest('You cannot submit a proposal to your own job');
    if (job.status !== 'open') throw ApiError.badRequest('This job is not accepting proposals');

    const existing = await Proposal.findOne({ job: job._id, freelancer: user._id });
    if (existing && existing.status !== 'withdrawn') {
      throw ApiError.conflict('You have already submitted a proposal for this job');
    }

    try {
      const proposal = existing || new Proposal({ job: job._id, freelancer: user._id, client: job.client });
      applyPatch(proposal, data);
      proposal.status = 'submitted';
      proposal.reviewNote = '';
      proposal.viewedAt = null;
      proposal.decidedAt = null;
      proposal.withdrawnAt = null;
      await proposal.save();
      await notificationService.publish({
        recipient: job.client,
        actor: user._id,
        eventKey: `proposal:${proposal._id}:submitted:${proposal.updatedAt.getTime()}`,
        type: 'proposal_submitted',
        category: 'proposals',
        title: `${user.name} submitted a proposal`,
        body: `A new proposal is ready for ${job.title}.`,
        actionUrl: `/dashboard/proposals/${proposal._id}`,
        entityType: 'proposal',
        entityId: proposal._id,
      }).catch(() => null);
      return proposal;
    } catch (error) {
      if (error?.code === 11000) throw ApiError.conflict('You have already submitted a proposal for this job');
      throw error;
    }
  },

  async findMineForJob(user, jobId) {
    const job = await Job.findById(jobId).select('_id');
    if (!job) throw ApiError.notFound('Job not found');
    return Proposal.findOne({ job: job._id, freelancer: user._id }).select('_id status createdAt updatedAt');
  },

  async listMine(user, { job, status, page = 1, limit = 20 }) {
    const filter = { freelancer: user._id };
    if (job) filter.job = job;
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
      Proposal.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'job', select: JOB_SELECT, populate: { path: 'client', select: USER_SELECT } }),
      Proposal.countDocuments(filter),
    ]);
    return pageData(items, total, page, limit);
  },

  async listReceived(user, { job, status, sort = 'recent', page = 1, limit = 20 }) {
    const filter = { client: user._id };
    if (job) filter.job = job;
    if (status) filter.status = status;
    const sortBy = sort === 'bid_asc' ? { 'bid.amount': 1 } : sort === 'bid_desc' ? { 'bid.amount': -1 } : { createdAt: -1 };
    const [items, total] = await Promise.all([
      Proposal.find(filter)
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('freelancer', USER_SELECT)
        .populate('job', JOB_SELECT),
      Proposal.countDocuments(filter),
    ]);
    const [profiles, offers] = await Promise.all([
      profileSnippets(items.map((proposal) => proposal.freelancer?._id).filter(Boolean)),
      offerSnippets(items.map((proposal) => proposal._id)),
    ]);
    return pageData(items.map((proposal) => {
      const item = proposal.toJSON();
      item.freelancerProfile = profiles[String(proposal.freelancer?._id)] || null;
      item.offer = offers[String(proposal._id)] || null;
      return item;
    }), total, page, limit);
  },

  async getById(user, id) {
    const proposal = await Proposal.findById(id)
      .populate('freelancer', USER_SELECT)
      .populate({ path: 'job', select: JOB_SELECT, populate: { path: 'client', select: USER_SELECT } });
    if (!proposal) throw ApiError.notFound('Proposal not found');

    const userId = String(user._id);
    const isAuthor = String(proposal.freelancer?._id || proposal.freelancer) === userId;
    const isClient = String(proposal.client) === userId;
    if (!isAuthor && !isClient) throw ApiError.notFound('Proposal not found');

    if (isClient && !proposal.viewedAt) {
      proposal.viewedAt = new Date();
      await proposal.save();
    }
    const [profiles, offers] = await Promise.all([
      profileSnippets([proposal.freelancer?._id].filter(Boolean)),
      offerSnippets([proposal._id]),
    ]);
    const item = proposal.toJSON();
    item.freelancerProfile = profiles[String(proposal.freelancer?._id)] || null;
    const latestOffer = offers[String(proposal._id)] || null;
    item.offer = isClient || latestOffer?.status !== 'draft' || latestOffer?.sentAt ? latestOffer : null;
    return item;
  },

  async update(user, id, patch) {
    const proposal = await ownedProposal(user, id);
    if (!ACTIVE_STATUSES.includes(proposal.status)) {
      throw ApiError.badRequest(`A ${proposal.status} proposal can no longer be edited`);
    }
    const job = await Job.findById(proposal.job).select('status');
    if (!job || job.status !== 'open') throw ApiError.badRequest('This job is no longer accepting proposal changes');
    applyPatch(proposal, patch);
    await proposal.save();
    return proposal;
  },

  async withdraw(user, id) {
    const proposal = await ownedProposal(user, id);
    if (!ACTIVE_STATUSES.includes(proposal.status)) {
      throw ApiError.badRequest(`This proposal is already ${proposal.status}`);
    }
    if (await Offer.exists({ proposal: proposal._id, active: true })) {
      throw ApiError.conflict('Respond to the active offer before withdrawing this proposal');
    }
    proposal.status = 'withdrawn';
    proposal.withdrawnAt = new Date();
    await proposal.save();
    await notificationService.publish({
      recipient: proposal.client,
      actor: user._id,
      eventKey: `proposal:${proposal._id}:withdrawn`,
      type: 'proposal_withdrawn',
      category: 'proposals',
      title: `${user.name} withdrew a proposal`,
      body: 'The proposal is no longer available for review.',
      actionUrl: `/dashboard/proposals/${proposal._id}`,
      entityType: 'proposal',
      entityId: proposal._id,
    }).catch(() => null);
    return proposal;
  },

  async decide(user, id, { decision, reviewNote }) {
    const proposal = await receivedProposal(user, id);
    if (proposal.status === 'withdrawn') throw ApiError.badRequest('This proposal was withdrawn by the freelancer');
    if (proposal.status === 'accepted') throw ApiError.badRequest('This proposal was already accepted');
    if (await Offer.exists({ proposal: proposal._id, active: true })) {
      throw ApiError.conflict('Withdraw the active offer before changing this proposal decision');
    }
    if (decision === 'reconsider' && !['shortlisted', 'rejected'].includes(proposal.status)) {
      throw ApiError.badRequest('Only shortlisted or rejected proposals can be reconsidered');
    }
    if (decision === 'shortlist' && proposal.status === 'shortlisted') throw ApiError.badRequest('This proposal is already shortlisted');
    if (decision === 'reject' && proposal.status === 'rejected') throw ApiError.badRequest('This proposal is already rejected');

    const nextStatus = { shortlist: 'shortlisted', reject: 'rejected', reconsider: 'submitted' }[decision];
    proposal.status = nextStatus;
    if (reviewNote !== undefined) proposal.reviewNote = reviewNote;
    proposal.decidedAt = decision === 'reconsider' ? null : new Date();
    if (!proposal.viewedAt) proposal.viewedAt = new Date();
    await proposal.save();
    await notificationService.publish({
      recipient: proposal.freelancer,
      actor: user._id,
      eventKey: `proposal:${proposal._id}:decision:${nextStatus}:${proposal.updatedAt.getTime()}`,
      type: 'proposal_status_changed',
      category: 'proposals',
      title: `Your proposal is now ${nextStatus}`,
      body: proposal.reviewNote || 'Open the proposal to review the latest status.',
      actionUrl: `/dashboard/proposals/${proposal._id}`,
      entityType: 'proposal',
      entityId: proposal._id,
      metadata: { status: nextStatus },
    }).catch(() => null);
    return proposal;
  },
};
