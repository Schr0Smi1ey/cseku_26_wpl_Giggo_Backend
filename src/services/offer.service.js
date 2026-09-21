import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Job } from '../models/Job.js';
import { Message } from '../models/Message.js';
import { Offer } from '../models/Offer.js';
import { OfferMessage } from '../models/OfferMessage.js';
import { OfferRevision } from '../models/OfferRevision.js';
import { Proposal } from '../models/Proposal.js';
import { ApiError } from '../utils/ApiError.js';
import { containsExternalContact } from '../utils/contact-policy.js';
import { notificationService } from './notification.service.js';
import { conversationService } from './conversation.service.js';
import { emitToConversation } from './realtime.service.js';

const ACTIVE_STATUSES = ['draft', 'sent', 'changes_requested', 'revising'];
const EDITABLE_STATUSES = ['draft', 'sent', 'changes_requested', 'revising'];
const USER_SELECT = 'name avatar role status';
const JOB_SELECT = 'title status budget client hiredProposal';
const PROPOSAL_SELECT = 'job freelancer client bid estimatedDays milestones status';
const TERM_FIELDS = ['title', 'description', 'budget', 'estimatedDays', 'startDate', 'endDate', 'expiresAt', 'terms', 'milestones'];

function id(value) {
  return String(value?._id || value);
}

function offerQuery(query) {
  return query
    .populate('client', USER_SELECT)
    .populate('freelancer', USER_SELECT)
    .populate('job', JOB_SELECT)
    .populate('proposal', PROPOSAL_SELECT);
}

function dateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function termsSnapshot(source) {
  const value = source.toObject?.() || source;
  return Object.fromEntries(TERM_FIELDS.map((field) => [field, value[field] ?? null]));
}

function validateTerms(terms) {
  const start = dateValue(terms.startDate);
  const end = dateValue(terms.endDate);
  if (start && end && end <= start) throw ApiError.badRequest('End date must be after the start date');

  const milestones = terms.milestones || [];
  if (terms.budget?.type === 'hourly' && milestones.length > 0) {
    throw ApiError.badRequest('Hourly offers cannot contain fixed-price milestones');
  }
  if (terms.budget?.type === 'fixed' && milestones.length > 0) {
    const total = milestones.reduce((sum, milestone) => sum + Number(milestone.amount || 0), 0);
    if (Math.abs(total - Number(terms.budget.amount || 0)) > 0.01) {
      throw ApiError.badRequest('Milestone amounts must equal the fixed offer amount');
    }
  }
  for (const milestone of milestones) {
    const due = dateValue(milestone.dueDate);
    if (due && start && due < start) throw ApiError.badRequest('Milestone dates cannot be before the offer start date');
    if (due && end && due > end) throw ApiError.badRequest('Milestone dates cannot be after the offer end date');
  }
}

function mergedTerms(offer, patch) {
  const current = termsSnapshot(offer);
  return Object.fromEntries(TERM_FIELDS.map((field) => [field, patch[field] ?? current[field]]));
}

async function ensureOfferConversation(offer) {
  await Promise.all([Conversation.init(), Message.init()]);
  let conversation = await Conversation.findOne({ contextType: 'offer', contextId: offer._id });
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        type: 'offer',
        title: offer.title || 'Offer negotiation',
        createdBy: offer.client,
        participantIds: [offer.client, offer.freelancer],
        participants: [
          { user: offer.client, role: 'owner' },
          { user: offer.freelancer, role: 'member' },
        ],
        contextType: 'offer',
        contextId: offer._id,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await Conversation.findOne({ contextType: 'offer', contextId: offer._id });
    }
  }

  const legacyMessages = await OfferMessage.find({ offer: offer._id }).sort({ createdAt: 1 }).lean();
  if (legacyMessages.length) {
    try {
      await Message.bulkWrite(legacyMessages.map((legacy) => ({
        updateOne: {
          filter: { conversation: conversation._id, 'metadata.legacyOfferMessageId': String(legacy._id) },
          update: {
            $setOnInsert: {
              conversation: conversation._id,
              sender: legacy.sender,
              kind: legacy.kind === 'system' ? 'system' : 'text',
              body: legacy.body,
              metadata: {
                legacyOfferMessageId: String(legacy._id),
                offerId: String(offer._id),
                offerKind: legacy.kind,
                senderRole: legacy.senderRole,
                revision: legacy.revision,
              },
              createdAt: legacy.createdAt,
            },
          },
          upsert: true,
        },
      })), { ordered: false });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  const latest = await Message.findOne({ conversation: conversation._id }).sort({ _id: -1 }).select('_id createdAt');
  if (latest && (!conversation.lastMessage || id(conversation.lastMessage) !== id(latest))) {
    conversation.lastMessage = latest._id;
    conversation.lastMessageAt = latest.createdAt;
    conversation.activityAt = latest.createdAt;
    await conversation.save();
  }
  return conversation;
}

async function createTimelineMessage(offer, { sender = null, senderRole = 'system', kind = 'system', body, revision = offer.revision }) {
  const conversation = await ensureOfferConversation(offer);
  const message = await Message.create({
    conversation: conversation._id,
    sender,
    kind: kind === 'system' ? 'system' : 'text',
    body,
    metadata: { offerId: String(offer._id), offerKind: kind, senderRole, revision: revision || null },
  });
  conversation.lastMessage = message._id;
  conversation.lastMessageAt = message.createdAt;
  conversation.activityAt = message.createdAt;
  await conversation.save();
  await message.populate('sender', USER_SELECT);
  emitToConversation(conversation._id, 'message:new', { conversationId: id(conversation), message });
  return message;
}

async function createSystemMessage(offer, body, revision = offer.revision) {
  return createTimelineMessage(offer, { body, revision });
}

async function publishOfferNotification({ offer, recipient, actor, event, type, title, body }) {
  return notificationService.publish({
    recipient,
    actor,
    eventKey: `offer:${offer._id}:${event}`,
    type,
    category: 'offers',
    title,
    body,
    actionUrl: `/dashboard/offers/${offer._id}`,
    entityType: 'offer',
    entityId: offer._id,
    metadata: { status: offer.status, revision: offer.revision },
  }).catch(() => null);
}

async function createPublishedRevision(offer, publishedAt = new Date()) {
  const existing = await OfferRevision.findOne({ offer: offer._id, number: offer.revision });
  if (existing) return { revision: existing, created: false };
  try {
    const revision = await OfferRevision.create({
      offer: offer._id,
      number: offer.revision,
      createdBy: offer.client,
      ...termsSnapshot(offer),
      publishedAt,
    });
    return { revision, created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const revision = await OfferRevision.findOne({ offer: offer._id, number: offer.revision });
    if (!revision) throw error;
    return { revision, created: false };
  }
}

async function ensurePublishedRevision(offer) {
  if (offer.currentRevision) return OfferRevision.findById(offer.currentRevision);
  if (!offer.sentAt && offer.status === 'draft') return null;
  const { revision } = await createPublishedRevision(offer, offer.sentAt || offer.createdAt || new Date());
  const update = { currentRevision: revision._id };
  if (offer.status === 'accepted') update.acceptedRevision = revision._id;
  await Offer.updateOne({ _id: offer._id, currentRevision: null }, { $set: update });
  offer.currentRevision = revision._id;
  if (offer.status === 'accepted') offer.acceptedRevision = revision._id;
  return revision;
}

async function participantOffer(user, offerId) {
  const offer = await Offer.findById(offerId);
  if (!offer) throw ApiError.notFound('Offer not found');
  const isClient = id(offer.client) === id(user);
  const isFreelancer = id(offer.freelancer) === id(user);
  if (!isClient && !isFreelancer) throw ApiError.notFound('Offer not found');
  if (isFreelancer && offer.status === 'draft' && !offer.sentAt) throw ApiError.notFound('Offer not found');
  return offer;
}

async function clientOffer(user, offerId) {
  const offer = await Offer.findById(offerId);
  if (!offer || id(offer.client) !== id(user)) throw ApiError.notFound('Offer not found');
  return offer;
}

async function eligibleProposal(user, proposalId) {
  const proposal = await Proposal.findById(proposalId);
  if (!proposal || id(proposal.client) !== id(user)) throw ApiError.notFound('Proposal not found');
  if (proposal.status !== 'shortlisted') throw ApiError.badRequest('Only a shortlisted proposal can receive an offer');
  const job = await Job.findById(proposal.job);
  if (!job || id(job.client) !== id(user) || id(proposal.client) !== id(job.client)) {
    throw ApiError.notFound('Job not found');
  }
  if (job.status !== 'open' || job.hiredProposal) throw ApiError.badRequest('This job is no longer available for hiring');
  if (id(proposal.job) !== id(job) || !proposal.freelancer) throw ApiError.badRequest('The proposal does not match this job');
  return { proposal, job };
}

async function revisionMapFor(offers) {
  const revisionIds = offers.map((offer) => offer.currentRevision).filter(Boolean);
  if (!revisionIds.length) return new Map();
  const revisions = await OfferRevision.find({ _id: mongoose.trusted({ $in: revisionIds }) }).lean();
  return new Map(revisions.map((revision) => [id(revision), revision]));
}

function visibleOffer(user, offer, revisionMap) {
  const item = offer.toObject?.() || offer;
  const isFreelancer = id(item.freelancer) === id(user);
  const published = revisionMap.get(id(item.currentRevision));
  if (isFreelancer && item.status === 'revising' && published) {
    for (const field of TERM_FIELDS) item[field] = published[field];
    item.displayRevision = published.number;
    item.revisionPending = true;
  } else {
    item.displayRevision = item.revision;
    item.revisionPending = false;
  }
  item.canShareContact = item.status === 'accepted';
  return item;
}

async function offerViews(user, offers) {
  const revisionMap = await revisionMapFor(offers);
  return offers.map((offer) => visibleOffer(user, offer, revisionMap));
}

async function populatedOffer(user, offerId, includeHistory = false) {
  const offer = await offerQuery(Offer.findById(offerId));
  if (!offer) throw ApiError.notFound('Offer not found');
  await ensurePublishedRevision(offer);
  const [item] = await offerViews(user, [offer]);
  if (!includeHistory) return item;
  const conversation = offer.sentAt || offer.status !== 'draft' ? await ensureOfferConversation(offer) : null;
  const [revisions, newestMessages] = await Promise.all([
    OfferRevision.find({ offer: offer._id }).sort({ number: -1 }).lean(),
    conversation ? Message.find({ conversation: conversation._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('sender', USER_SELECT)
      .lean() : [],
  ]);
  item.revisions = revisions;
  item.conversationId = conversation?._id || null;
  item.messages = newestMessages.reverse().map((message) => ({
    ...message,
    kind: message.metadata?.offerKind || message.kind,
    senderRole: message.metadata?.senderRole || (message.kind === 'system' ? 'system' : null),
    revision: message.metadata?.revision || null,
  }));
  return item;
}

async function rollbackAcceptedOffer(offer, proposal, job) {
  await Promise.allSettled([
    Offer.updateOne(
      { _id: offer._id, status: 'accepted' },
      { $set: { status: 'sent', active: true, acceptedAt: null, acceptedRevision: null } },
    ),
    Proposal.updateOne(
      { _id: proposal._id, status: 'accepted' },
      { $set: { status: 'shortlisted', decidedAt: null } },
    ),
    Job.updateOne(
      { _id: job._id, hiredProposal: proposal._id },
      { $set: { status: 'open', hiredProposal: null } },
    ),
  ]);
}

export const offerService = {
  async create(user, { proposal: proposalId, ...terms }) {
    await Offer.init();
    const { proposal, job } = await eligibleProposal(user, proposalId);
    validateTerms(terms);
    try {
      const offer = await Offer.create({
        ...terms,
        client: user._id,
        freelancer: proposal.freelancer,
        job: job._id,
        proposal: proposal._id,
        status: 'draft',
        active: true,
        revision: 1,
      });
      return populatedOffer(user, offer._id);
    } catch (error) {
      if (error?.code === 11000) throw ApiError.conflict('An active offer already exists for this proposal');
      throw error;
    }
  },

  async list(user, { status, page = 1, limit = 20 }) {
    if (!user.hasRole('client') && status === 'draft') {
      return { items: [], pagination: { page, limit, total: 0, totalPages: 1 } };
    }
    const filter = user.hasRole('client')
      ? { client: user._id, ...(status ? { status } : {}) }
      : { freelancer: user._id, status: status || mongoose.trusted({ $ne: 'draft' }) };
    const [offers, total] = await Promise.all([
      offerQuery(Offer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)),
      Offer.countDocuments(filter),
    ]);
    return {
      items: await offerViews(user, offers),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async get(user, offerId) {
    const offer = await participantOffer(user, offerId);
    return populatedOffer(user, offer._id, true);
  },

  async update(user, offerId, patch) {
    const offer = await clientOffer(user, offerId);
    if (!EDITABLE_STATUSES.includes(offer.status)) throw ApiError.badRequest(`An ${offer.status} offer cannot be revised`);
    const terms = mergedTerms(offer, patch);
    validateTerms(terms);

    const startsNewRevision = ['sent', 'changes_requested'].includes(offer.status);
    if (startsNewRevision) await ensurePublishedRevision(offer);
    const nextStatus = startsNewRevision ? 'revising' : offer.status;
    const nextRevision = startsNewRevision ? offer.revision + 1 : offer.revision;
    const updated = await Offer.findOneAndUpdate(
      { _id: offer._id, client: user._id, status: offer.status, revision: offer.revision },
      { $set: { ...patch, status: nextStatus, active: true, revision: nextRevision, revisedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.conflict('The offer changed before your revision was saved');
    if (startsNewRevision) await createSystemMessage(updated, `Client started revision ${nextRevision}.`, nextRevision);
    return populatedOffer(user, updated._id, true);
  },

  async send(user, offerId) {
    const offer = await clientOffer(user, offerId);
    if (offer.status === 'sent' && offer.currentRevision) return populatedOffer(user, offer._id, true);
    if (!['draft', 'revising'].includes(offer.status)) {
      const message = offer.status === 'changes_requested'
        ? 'Revise the offer before sending a response to the change request'
        : 'Offer cannot be sent in its current state';
      throw ApiError.badRequest(message);
    }
    await eligibleProposal(user, offer.proposal);
    validateTerms(offer);
    const now = new Date();
    const expiresAt = offer.expiresAt || new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    if (expiresAt <= now) throw ApiError.badRequest('Choose a future offer expiration date');

    offer.expiresAt = expiresAt;
    const { revision, created } = await createPublishedRevision(offer, now);
    const sent = await Offer.findOneAndUpdate(
      { _id: offer._id, client: user._id, status: offer.status, revision: offer.revision },
      { $set: { status: 'sent', sentAt: now, expiresAt, active: true, currentRevision: revision._id, changeRequest: '' } },
      { new: true, runValidators: true },
    );
    if (!sent) {
      if (created) await OfferRevision.deleteOne({ _id: revision._id });
      throw ApiError.conflict('The offer changed before it could be sent');
    }
    await createSystemMessage(sent, `Client sent offer revision ${sent.revision}.`, sent.revision);
    await publishOfferNotification({
      offer: sent,
      recipient: sent.freelancer,
      actor: user._id,
      event: `sent:${sent.revision}`,
      type: 'offer_sent',
      title: `Offer revision ${sent.revision} is ready`,
      body: `${user.name} sent terms for your review.`,
    });
    return populatedOffer(user, sent._id, true);
  },

  async requestChanges(user, offerId, message) {
    const offer = await participantOffer(user, offerId);
    if (id(offer.freelancer) !== id(user)) throw ApiError.notFound('Offer not found');
    if (containsExternalContact(message)) throw ApiError.badRequest('Keep contact details on Giggo until the offer is accepted');
    await ensurePublishedRevision(offer);
    const updated = await Offer.findOneAndUpdate(
      { _id: offer._id, freelancer: user._id, status: 'sent', revision: offer.revision, expiresAt: mongoose.trusted({ $gt: new Date() }) },
      { $set: { status: 'changes_requested', changeRequest: message, changesRequestedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.badRequest('This offer is no longer awaiting your response');
    await createTimelineMessage(updated, { sender: user._id, senderRole: 'freelancer', kind: 'change_request', body: message, revision: updated.revision });
    await publishOfferNotification({
      offer: updated,
      recipient: updated.client,
      actor: user._id,
      event: `changes-requested:${updated.revision}`,
      type: 'offer_changes_requested',
      title: 'Changes requested on your offer',
      body: message.slice(0, 160),
    });
    return populatedOffer(user, updated._id, true);
  },

  async sendMessage(user, offerId, body) {
    const offer = await participantOffer(user, offerId);
    if (!offer.sentAt && offer.status === 'draft') throw ApiError.badRequest('Send the offer before starting a conversation');
    if (['rejected', 'withdrawn'].includes(offer.status)) throw ApiError.badRequest('This negotiation is closed');
    if (offer.status !== 'accepted' && containsExternalContact(body)) {
      throw ApiError.badRequest('Keep contact details on Giggo until the offer is accepted');
    }
    const senderRole = id(offer.client) === id(user) ? 'client' : 'freelancer';
    const conversation = await ensureOfferConversation(offer);
    const message = await conversationService.send(user, conversation._id, {
      body,
      clientMessageId: crypto.randomUUID(),
      metadata: { offerId: String(offer._id), offerKind: 'message', senderRole, revision: offer.currentRevision ? Math.max(1, offer.revision) : null },
    });
    return message;
  },

  async reject(user, offerId) {
    const offer = await participantOffer(user, offerId);
    if (id(offer.freelancer) !== id(user)) throw ApiError.notFound('Offer not found');
    const updated = await Offer.findOneAndUpdate(
      { _id: offer._id, freelancer: user._id, status: mongoose.trusted({ $in: ['sent', 'changes_requested', 'revising'] }) },
      { $set: { status: 'rejected', active: false, rejectedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.badRequest('This offer can no longer be declined');
    await createSystemMessage(updated, 'Freelancer declined the offer.');
    await publishOfferNotification({ offer: updated, recipient: updated.client, actor: user._id, event: 'rejected', type: 'offer_rejected', title: 'Offer declined', body: `${user.name} declined the offer.` });
    return populatedOffer(user, updated._id, true);
  },

  async withdraw(user, offerId) {
    const offer = await clientOffer(user, offerId);
    const updated = await Offer.findOneAndUpdate(
      { _id: offer._id, client: user._id, status: mongoose.trusted({ $in: ACTIVE_STATUSES }) },
      { $set: { status: 'withdrawn', active: false, withdrawnAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.badRequest('This offer can no longer be withdrawn');
    if (updated.sentAt) await createSystemMessage(updated, 'Client withdrew the offer.');
    if (updated.sentAt) await publishOfferNotification({ offer: updated, recipient: updated.freelancer, actor: user._id, event: 'withdrawn', type: 'offer_withdrawn', title: 'Offer withdrawn', body: `${user.name} withdrew the offer.` });
    return populatedOffer(user, updated._id, true);
  },

  async accept(user, offerId, revisionNumber) {
    const existing = await participantOffer(user, offerId);
    if (id(existing.freelancer) !== id(user)) throw ApiError.notFound('Offer not found');
    const published = await ensurePublishedRevision(existing);
    if (!published || Number(revisionNumber) !== published.number || Number(revisionNumber) !== existing.revision) {
      throw ApiError.conflict('This offer revision is no longer current. Review the latest terms before accepting.');
    }
    if (existing.status === 'accepted') {
      if (id(existing.acceptedRevision) !== id(published)) throw ApiError.conflict('A different offer revision was accepted');
      return populatedOffer(user, existing._id, true);
    }
    if (existing.status !== 'sent' || (existing.expiresAt && existing.expiresAt <= new Date())) {
      throw ApiError.badRequest('This offer is no longer available');
    }

    const proposal = await Proposal.findOne({
      _id: existing.proposal,
      job: existing.job,
      client: existing.client,
      freelancer: user._id,
      status: 'shortlisted',
    });
    if (!proposal) throw ApiError.badRequest('The related proposal is no longer eligible for hiring');

    const job = await Job.findOneAndUpdate(
      { _id: existing.job, client: existing.client, status: 'open', hiredProposal: null },
      { $set: { status: 'filled', hiredProposal: proposal._id } },
      { new: true },
    );
    if (!job) throw ApiError.conflict('This job has already been filled or closed');

    const now = new Date();
    const accepted = await Offer.findOneAndUpdate(
      {
        _id: existing._id,
        freelancer: user._id,
        status: 'sent',
        revision: revisionNumber,
        currentRevision: published._id,
        $or: [{ expiresAt: null }, { expiresAt: mongoose.trusted({ $gt: now }) }],
      },
      { $set: { status: 'accepted', active: false, acceptedAt: now, acceptedRevision: published._id } },
      { new: true, runValidators: true },
    );
    if (!accepted) {
      await Job.updateOne({ _id: job._id, hiredProposal: proposal._id }, { $set: { status: 'open', hiredProposal: null } });
      throw ApiError.conflict('The offer changed before it could be accepted');
    }

    const proposalResult = await Proposal.updateOne(
      { _id: proposal._id, status: 'shortlisted' },
      { $set: { status: 'accepted', decidedAt: now } },
    );
    if (proposalResult.modifiedCount !== 1) {
      await rollbackAcceptedOffer(accepted, proposal, job);
      throw ApiError.conflict('The proposal changed before the offer could be accepted');
    }

    await Promise.allSettled([
      Offer.updateMany(
        { _id: mongoose.trusted({ $ne: accepted._id }), job: job._id, active: true },
        { $set: { status: 'withdrawn', active: false, withdrawnAt: now } },
      ),
      Proposal.updateMany(
        { _id: mongoose.trusted({ $ne: proposal._id }), job: job._id, status: mongoose.trusted({ $in: ['submitted', 'shortlisted'] }) },
        { $set: { status: 'rejected', decidedAt: now } },
      ),
    ]);
    await createSystemMessage(accepted, `Freelancer accepted offer revision ${published.number}.`, published.number);
    await publishOfferNotification({ offer: accepted, recipient: accepted.client, actor: user._id, event: `accepted:${published.number}`, type: 'offer_accepted', title: 'Offer accepted', body: `${user.name} accepted revision ${published.number}.` });
    return populatedOffer(user, accepted._id, true);
  },
};
