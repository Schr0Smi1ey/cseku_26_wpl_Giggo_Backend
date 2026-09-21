import mongoose from 'mongoose';
import { AIAnalysis } from '../models/AIAnalysis.js';
import { AIUsage } from '../models/AIUsage.js';
import { ClientProfile } from '../models/ClientProfile.js';
import { Contract } from '../models/Contract.js';
import { Conversation } from '../models/Conversation.js';
import { DeletedIdentity } from '../models/DeletedIdentity.js';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { Job } from '../models/Job.js';
import { Message } from '../models/Message.js';
import { Notification } from '../models/Notification.js';
import { NotificationPreference } from '../models/NotificationPreference.js';
import { Offer } from '../models/Offer.js';
import { OfferMessage } from '../models/OfferMessage.js';
import { OfferRevision } from '../models/OfferRevision.js';
import { Proposal } from '../models/Proposal.js';
import { Project } from '../models/Project.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { SavedJob } from '../models/SavedJob.js';
import { SavedMessage } from '../models/SavedMessage.js';
import { ROLES, User } from '../models/User.js';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { removeAvatarAsset } from './avatar.storage.service.js';
import { removeCvFile } from './profile.service.js';
import { deleteSupabaseIdentity } from './supabase-admin.service.js';
import { clearVerificationStateForUser } from './verification.service.js';
import { removeVerificationDocument } from './verification.storage.service.js';

const recentAuthenticationSeconds = 10 * 60;
const clockToleranceSeconds = 30;

function requireRecentAuthentication(identity) {
  const issuedAt = Number(identity?.issuedAt || 0);
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  // Supabase and the API host can differ slightly in time. A fresh token must
  // not fail solely because the issuer's clock is a few seconds ahead.
  if (!Number.isFinite(issuedAt) || issuedAt <= 0 || age < -clockToleranceSeconds || age > recentAuthenticationSeconds) {
    throw new ApiError(401, 'Sign in again before deleting your account', 'RECENT_AUTH_REQUIRED');
  }
}

export const accountDeletionService = {
  async remove(user, identity) {
    requireRecentAuthentication(identity);
    if (user.hasRole(ROLES.ADMIN)) throw ApiError.forbidden('Administrator accounts require a separate reviewed removal process');
    if (!user.supabaseUserId) throw ApiError.badRequest('This account is not linked to Supabase authentication');

    const account = await User.findOneAndUpdate(
      { _id: user._id, status: 'active' },
      { $set: { status: 'deletion_pending' } },
      { new: true },
    ).select('+avatarStorageKey +avatarStorageProvider');
    if (!account) throw ApiError.conflict('Account deletion is already in progress');

    let tombstoneCreated = false;
    try {
      const tombstoneResult = await DeletedIdentity.updateOne(
        { supabaseUserId: account.supabaseUserId },
        { $setOnInsert: { supabaseUserId: account.supabaseUserId, deletedAt: new Date() } },
        { upsert: true },
      );
      tombstoneCreated = tombstoneResult.upsertedCount === 1;
      if (!tombstoneCreated) throw ApiError.conflict('Account deletion is already in progress');
      await deleteSupabaseIdentity(account.supabaseUserId);
    } catch (error) {
      const rollbackTasks = [
        User.updateOne({ _id: account._id, status: 'deletion_pending' }, { $set: { status: 'active' } }),
      ];
      if (tombstoneCreated) rollbackTasks.push(DeletedIdentity.deleteOne({ supabaseUserId: account.supabaseUserId }));
      await Promise.allSettled(rollbackTasks);
      throw error;
    }

    const [freelancerProfile, verificationRequests, ownedJobs, relatedOffers, relatedContracts, relatedProjects] = await Promise.all([
      FreelancerProfile.findOne({ user: account._id }),
      VerificationRequest.find({ user: account._id }).select('+documents.path'),
      Job.find({ client: account._id }).select('_id'),
      Offer.find({ $or: [{ freelancer: account._id }, { client: account._id }] }).select('_id'),
      Contract.find({ $or: [{ freelancer: account._id }, { client: account._id }] }).select('_id'),
      Project.find({ $or: [{ freelancer: account._id }, { client: account._id }] }).select('_id'),
    ]);
    const ownedJobIds = ownedJobs.map((job) => job._id);
    const relatedOfferIds = relatedOffers.map((offer) => offer._id);
    const relatedContractIds = relatedContracts.map((contract) => contract._id);
    const relatedProjectIds = relatedProjects.map((project) => project._id);
    const relatedConversations = await Conversation.find({ participantIds: account._id }).select('_id type');
    const removedConversationIds = relatedConversations.filter((conversation) => conversation.type !== 'group').map((conversation) => conversation._id);
    const retainedGroupIds = relatedConversations.filter((conversation) => conversation.type === 'group').map((conversation) => conversation._id);
    const removedMessageIds = await Message.find({ conversation: mongoose.trusted({ $in: removedConversationIds }) }).distinct('_id');
    const savedJobsFilter = ownedJobIds.length
      ? { $or: [{ user: account._id }, { job: mongoose.trusted({ $in: ownedJobIds }) }] }
      : { user: account._id };

    await Promise.all([
      AIAnalysis.deleteMany({ user: account._id }),
      AIUsage.deleteMany({ user: account._id }),
      ClientProfile.deleteMany({ user: account._id }),
      FreelancerProfile.deleteMany({ user: account._id }),
      RefreshToken.deleteMany({ user: account._id }),
      SavedJob.deleteMany(savedJobsFilter),
      SavedMessage.deleteMany({ $or: [{ user: account._id }, { message: mongoose.trusted({ $in: removedMessageIds }) }] }),
      NotificationPreference.deleteMany({ user: account._id }),
      Notification.deleteMany({ $or: [
        { recipient: account._id },
        { entityType: 'conversation', entityId: mongoose.trusted({ $in: removedConversationIds }) },
        { entityType: 'offer', entityId: mongoose.trusted({ $in: relatedOfferIds }) },
        { entityType: 'contract', entityId: mongoose.trusted({ $in: relatedContractIds }) },
        { entityType: 'project', entityId: mongoose.trusted({ $in: relatedProjectIds }) },
      ] }),
      VerificationRequest.deleteMany({ user: account._id }),
      Job.deleteMany({ client: account._id }),
      OfferMessage.deleteMany({ offer: mongoose.trusted({ $in: relatedOfferIds }) }),
      OfferRevision.deleteMany({ offer: mongoose.trusted({ $in: relatedOfferIds }) }),
      Offer.deleteMany({ $or: [{ freelancer: account._id }, { client: account._id }] }),
      Contract.deleteMany({ $or: [{ freelancer: account._id }, { client: account._id }] }),
      Project.deleteMany({ $or: [{ freelancer: account._id }, { client: account._id }] }),
      Proposal.deleteMany({ $or: [{ freelancer: account._id }, { client: account._id }] }),
      Message.deleteMany({ conversation: mongoose.trusted({ $in: removedConversationIds }) }),
      Conversation.deleteMany({ _id: mongoose.trusted({ $in: removedConversationIds }) }),
      Message.updateMany(
        { conversation: mongoose.trusted({ $in: retainedGroupIds }), sender: account._id },
        { $set: { sender: null, body: '', deletedAt: new Date(), reactions: [], pinnedBy: [] } },
      ),
      Message.updateMany(
        { conversation: mongoose.trusted({ $in: retainedGroupIds }) },
        { $pull: { reactions: { user: account._id }, pinnedBy: account._id } },
      ),
      Conversation.updateMany(
        { _id: mongoose.trusted({ $in: retainedGroupIds }) },
        { $pull: { participantIds: account._id, participants: { user: account._id } } },
      ),
    ]);
    await Notification.updateMany({ actor: account._id }, { $set: { actor: null } });
    await User.deleteOne({ _id: account._id });
    clearVerificationStateForUser(account._id);

    const storedDocuments = verificationRequests.flatMap((request) => request.documents || []);
    const remoteAvatarCopyMayRemain = account.avatarStorageProvider === 'imgbb' && Boolean(account.avatarStorageKey);
    await Promise.allSettled([
      removeAvatarAsset(account.avatarStorageKey, account.avatarStorageProvider),
      removeCvFile(freelancerProfile?.cv?.storageKey),
      ...storedDocuments.map((document) => removeVerificationDocument(document.path)),
    ]);

    return { deleted: true, remoteAvatarCopyMayRemain };
  },
};
