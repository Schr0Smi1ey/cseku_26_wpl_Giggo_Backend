import mongoose from 'mongoose';
import { Contract, CONTRACT_STATUSES } from '../models/Contract.js';
import { Offer } from '../models/Offer.js';
import { OfferRevision } from '../models/OfferRevision.js';
import { Project } from '../models/Project.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from './notification.service.js';
import { projectService } from './project.service.js';

const USER_SELECT = 'name avatar role status';
const JOB_SELECT = 'title status';
const VALID_TRANSITIONS = {
  [CONTRACT_STATUSES.ACTIVE]: [CONTRACT_STATUSES.PAUSED, CONTRACT_STATUSES.COMPLETED, CONTRACT_STATUSES.CANCELLED],
  [CONTRACT_STATUSES.PAUSED]: [CONTRACT_STATUSES.ACTIVE, CONTRACT_STATUSES.CANCELLED],
  [CONTRACT_STATUSES.COMPLETED]: [],
  [CONTRACT_STATUSES.CANCELLED]: [],
};

const id = (value) => String(value?._id || value);

function contractQuery(query, { includeHistory = false } = {}) {
  const populated = query
    .populate('client', USER_SELECT)
    .populate('freelancer', USER_SELECT)
    .populate('job', JOB_SELECT);
  return includeHistory
    ? populated.populate('statusHistory.actor', 'name role')
    : populated.select('-statusHistory');
}

function ensureParticipant(contract, user) {
  const isClient = id(contract.client) === id(user);
  const isFreelancer = id(contract.freelancer) === id(user);
  if (!isClient && !isFreelancer) throw ApiError.notFound('Contract not found');
  return { isClient, isFreelancer };
}

async function publishContractNotification({ contract, recipient, actor, event, type, title, body }) {
  return notificationService.publish({
    recipient,
    actor,
    eventKey: `contract:${contract._id}:${event}`,
    type,
    category: 'contracts',
    title,
    body,
    actionUrl: `/dashboard/contracts/${contract._id}`,
    entityType: 'contract',
    entityId: contract._id,
    metadata: { status: contract.status, offerId: contract.offer },
  }).catch(() => null);
}

export const contractService = {
  async ensureForAcceptedOffer(offer, actor = null) {
    if (offer.status !== 'accepted' || !offer.acceptedRevision) {
      throw ApiError.badRequest('A contract requires an accepted offer revision');
    }
    await Contract.init();
    const existing = await Contract.findOne({ offer: offer._id });
    if (existing) {
      if (id(offer.contract) !== id(existing)) await Offer.updateOne({ _id: offer._id }, { $set: { contract: existing._id } });
      await projectService.ensureForContract(existing, actor);
      return existing;
    }

    const revision = await OfferRevision.findOne({ _id: offer.acceptedRevision, offer: offer._id }).lean();
    if (!revision) throw ApiError.conflict('The accepted offer revision is unavailable');
    const now = offer.acceptedAt || new Date();
    let contract;
    let created = false;
    try {
      contract = await Contract.create({
        offer: offer._id,
        acceptedRevision: revision._id,
        proposal: offer.proposal,
        job: offer.job,
        client: offer.client,
        freelancer: offer.freelancer,
        title: revision.title,
        description: revision.description,
        budget: revision.budget,
        estimatedDays: revision.estimatedDays,
        startDate: revision.startDate,
        endDate: revision.endDate,
        terms: revision.terms,
        milestones: (revision.milestones || []).map((milestone) => ({
          sourceMilestoneId: milestone._id,
          title: milestone.title,
          amount: milestone.amount,
          dueDate: milestone.dueDate,
          description: milestone.description,
        })),
        status: CONTRACT_STATUSES.ACTIVE,
        activatedAt: now,
        statusHistory: [{
          from: null,
          to: CONTRACT_STATUSES.ACTIVE,
          actor: actor?._id || actor || null,
          actorRole: actor ? (id(actor) === id(offer.client) ? 'client' : 'freelancer') : 'system',
          note: actor ? 'Contract created from the accepted offer.' : 'Contract backfilled from an accepted offer.',
          at: now,
        }],
      });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      contract = await Contract.findOne({ $or: [{ offer: offer._id }, { job: offer.job }] });
      if (!contract || id(contract.offer) !== id(offer)) {
        throw ApiError.conflict('A different contract already exists for this job');
      }
    }
    try {
      await projectService.ensureForContract(contract, actor);
    } catch (error) {
      if (created) {
        await Promise.allSettled([
          Project.deleteMany({ contract: contract._id }),
          Contract.deleteOne({ _id: contract._id }),
        ]);
      }
      throw error;
    }
    await Offer.updateOne({ _id: offer._id }, { $set: { contract: contract._id } });
    offer.contract = contract._id;

    if (created) {
      await Promise.all([
        publishContractNotification({
          contract,
          recipient: offer.client,
          actor: actor?._id || actor || null,
          event: 'created:client',
          type: 'contract_created',
          title: 'Contract activated',
          body: `${contract.title} is now an active contract.`,
        }),
        publishContractNotification({
          contract,
          recipient: offer.freelancer,
          actor: actor?._id || actor || null,
          event: 'created:freelancer',
          type: 'contract_created',
          title: 'Contract activated',
          body: `${contract.title} is now an active contract.`,
        }),
      ]);
    }
    return contract;
  },

  async list(user, { status, page = 1, limit = 20 }) {
    const participantFilter = mongoose.trusted({ $or: [{ client: user._id }, { freelancer: user._id }] });
    const filter = status ? { $and: [participantFilter, { status }] } : participantFilter;
    const [items, total] = await Promise.all([
      contractQuery(Contract.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)),
      Contract.countDocuments(filter),
    ]);
    await Promise.all(items.map((contract) => projectService.ensureForContract(contract)));
    return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async get(user, contractId) {
    const contract = await contractQuery(Contract.findById(contractId), { includeHistory: true });
    if (!contract) throw ApiError.notFound('Contract not found');
    ensureParticipant(contract, user);
    await projectService.ensureForContract(contract);
    return contract;
  },

  async transition(user, contractId, { status, note = '' }) {
    const contract = await Contract.findById(contractId);
    if (!contract) throw ApiError.notFound('Contract not found');
    const { isClient } = ensureParticipant(contract, user);
    if (!VALID_TRANSITIONS[contract.status]?.includes(status)) {
      throw ApiError.badRequest(`An ${contract.status} contract cannot move to ${status}`);
    }
    if (status !== CONTRACT_STATUSES.CANCELLED && !isClient) {
      throw ApiError.forbidden('Only the client can pause, resume, or complete this contract');
    }
    if (status === CONTRACT_STATUSES.CANCELLED && note.trim().length < 3) {
      throw ApiError.badRequest('Add a reason before cancelling the contract');
    }

    const now = new Date();
    const timestampPatch = {
      ...(status === CONTRACT_STATUSES.ACTIVE ? { activatedAt: now, pausedAt: null } : {}),
      ...(status === CONTRACT_STATUSES.PAUSED ? { pausedAt: now } : {}),
      ...(status === CONTRACT_STATUSES.COMPLETED ? { completedAt: now } : {}),
      ...(status === CONTRACT_STATUSES.CANCELLED ? { cancelledAt: now } : {}),
    };
    const updated = await Contract.findOneAndUpdate(
      { _id: contract._id, status: contract.status },
      {
        $set: { status, ...timestampPatch },
        $push: { statusHistory: { from: contract.status, to: status, actor: user._id, actorRole: isClient ? 'client' : 'freelancer', note, at: now } },
      },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.conflict('The contract changed before your action was saved');

    await projectService.reflectContractTransition(updated, user, note).catch((error) => {
      console.error('Project synchronization failed after contract transition', {
        contractId: String(updated._id),
        status: updated.status,
        errorName: error?.name,
        errorCode: error?.code,
      });
    });

    const recipient = isClient ? contract.freelancer : contract.client;
    await publishContractNotification({
      contract: updated,
      recipient,
      actor: user._id,
      event: `${status}:${updated.statusHistory.at(-1)._id}`,
      type: `contract_${status}`,
      title: `Contract ${status}`,
      body: note || `${user.name} changed the contract status to ${status}.`,
    });
    return contractQuery(Contract.findById(updated._id), { includeHistory: true });
  },
};
