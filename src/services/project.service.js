import mongoose from 'mongoose';
import { Contract, CONTRACT_STATUSES } from '../models/Contract.js';
import { Conversation } from '../models/Conversation.js';
import { Project } from '../models/Project.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from './notification.service.js';

const USER_SELECT = 'name avatar role status';
const JOB_SELECT = 'title status';
const id = (value) => String(value?._id || value);

function ensureParticipant(project, user) {
  const isClient = id(project.client) === id(user);
  const isFreelancer = id(project.freelancer) === id(user);
  if (!isClient && !isFreelancer) throw ApiError.notFound('Project not found');
  return { isClient, isFreelancer };
}

function populatedProject(query, { includeHistory = false } = {}) {
  const result = query.populate({
    path: 'contract',
    populate: [
      { path: 'client', select: USER_SELECT },
      { path: 'freelancer', select: USER_SELECT },
      { path: 'job', select: JOB_SELECT },
    ],
  });
  return includeHistory
    ? result.populate('progressHistory.actor', 'name role')
    : result.select('-progressHistory');
}

function present(project, conversationId = null) {
  const item = project.toObject?.() || project;
  const status = item.contract?.status || 'active';
  return {
    ...item,
    status,
    progress: status === CONTRACT_STATUSES.COMPLETED ? 100 : item.progress,
    conversationId,
  };
}

async function publishProgressNotification(project, actor, historyId) {
  return notificationService.publish({
    recipient: project.client,
    actor: actor._id,
    eventKey: `project:${project._id}:progress:${historyId}`,
    type: 'project_progress_updated',
    category: 'contracts',
    title: 'Project progress updated',
    body: `${actor.name} reported ${project.progress}% progress.`,
    actionUrl: `/dashboard/projects/${project._id}`,
    entityType: 'project',
    entityId: project._id,
    metadata: { progress: project.progress, contractId: project.contract },
  }).catch(() => null);
}

export const projectService = {
  async ensureForContract(contract, actor = null) {
    await Project.init();
    const existing = await Project.findOne({ contract: contract._id });
    if (existing) {
      if (id(contract.project) !== id(existing)) {
        await Contract.updateOne({ _id: contract._id }, { $set: { project: existing._id } });
        contract.project = existing._id;
      }
      return existing;
    }

    const now = contract.activatedAt || new Date();
    let project;
    try {
      project = await Project.create({
        contract: contract._id,
        offer: contract.offer,
        job: contract.job,
        client: contract.client,
        freelancer: contract.freelancer,
        progress: contract.status === CONTRACT_STATUSES.COMPLETED ? 100 : 0,
        progressUpdatedAt: now,
        progressUpdatedBy: actor?._id || actor || null,
        progressHistory: [{
          from: null,
          to: contract.status === CONTRACT_STATUSES.COMPLETED ? 100 : 0,
          actor: actor?._id || actor || null,
          actorRole: actor ? (id(actor) === id(contract.client) ? 'client' : 'freelancer') : 'system',
          note: actor ? 'Project workspace created from the accepted contract.' : 'Project workspace backfilled from an existing contract.',
          at: now,
        }],
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      project = await Project.findOne({ $or: [{ contract: contract._id }, { job: contract.job }] });
      if (!project || id(project.contract) !== id(contract)) {
        throw ApiError.conflict('A different project workspace already exists for this job');
      }
    }
    await Contract.updateOne({ _id: contract._id }, { $set: { project: project._id } });
    contract.project = project._id;
    return project;
  },

  async list(user, { page = 1, limit = 20 }) {
    const participantFilter = mongoose.trusted({ $or: [{ client: user._id }, { freelancer: user._id }] });
    const contracts = await Contract.find(participantFilter).select('_id offer job client freelancer status activatedAt project');
    await Promise.all(contracts.map((contract) => this.ensureForContract(contract)));

    const [projects, total] = await Promise.all([
      populatedProject(Project.find(participantFilter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)),
      Project.countDocuments(participantFilter),
    ]);
    return {
      items: projects.map((project) => present(project)),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async get(user, projectId) {
    const project = await populatedProject(Project.findById(projectId), { includeHistory: true });
    if (!project) throw ApiError.notFound('Project not found');
    ensureParticipant(project, user);
    const conversation = await Conversation.findOne({ contextType: 'offer', contextId: project.offer }).select('_id');
    return present(project, conversation?._id || null);
  },

  async updateProgress(user, projectId, { progress, note }) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    const { isFreelancer } = ensureParticipant(project, user);
    if (!isFreelancer) throw ApiError.forbidden('Only the freelancer can report project progress');

    const contract = await Contract.findById(project.contract).select('status');
    if (!contract) throw ApiError.notFound('Project contract not found');
    if (contract.status !== CONTRACT_STATUSES.ACTIVE) {
      throw ApiError.badRequest('Progress can only be updated while the contract is active');
    }
    if (progress <= project.progress) throw ApiError.badRequest('Progress must be greater than the previous update');

    const now = new Date();
    const historyId = new mongoose.Types.ObjectId();
    const updated = await Project.findOneAndUpdate(
      { _id: project._id, progress: project.progress },
      {
        $set: { progress, progressUpdatedAt: now, progressUpdatedBy: user._id },
        $push: {
          progressHistory: {
            $each: [{ _id: historyId, from: project.progress, to: progress, actor: user._id, actorRole: 'freelancer', note, at: now }],
            $slice: -100,
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.conflict('Project progress changed before your update was saved');
    await publishProgressNotification(updated, user, historyId);
    return this.get(user, updated._id);
  },

  async reflectContractTransition(contract, actor, note = '') {
    if (contract.status !== CONTRACT_STATUSES.COMPLETED) return;
    const project = await this.ensureForContract(contract, actor);
    if (project.progress === 100) return;
    const now = contract.completedAt || new Date();
    await Project.updateOne(
      { _id: project._id, progress: mongoose.trusted({ $lt: 100 }) },
      {
        $set: { progress: 100, progressUpdatedAt: now, progressUpdatedBy: actor._id },
        $push: {
          progressHistory: {
            $each: [{ from: project.progress, to: 100, actor: actor._id, actorRole: 'client', note: note || 'Contract completed by the client.', at: now }],
            $slice: -100,
          },
        },
      },
      { runValidators: true },
    );
  },
};
