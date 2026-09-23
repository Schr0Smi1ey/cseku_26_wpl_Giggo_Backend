import mongoose from 'mongoose';
import { Contract, CONTRACT_STATUSES } from '../models/Contract.js';
import { Conversation } from '../models/Conversation.js';
import { Milestone, MILESTONE_STATUSES } from '../models/Milestone.js';
import { Project } from '../models/Project.js';
import { WorkSubmission, SUBMISSION_STATUSES } from '../models/WorkSubmission.js';
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

function present(project, conversationId = null, milestones = undefined) {
  const item = project.toObject?.() || project;
  const status = item.contract?.status || 'active';
  return {
    ...item,
    status,
    progress: status === CONTRACT_STATUSES.COMPLETED ? 100 : item.progress,
    conversationId,
    ...(milestones === undefined ? {} : { milestones }),
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

async function publishMilestoneNotification({ project, recipient, actor, event, type, title, body, milestone, submission = null }) {
  return notificationService.publish({
    recipient,
    actor: actor._id,
    eventKey: `project:${project._id}:milestone:${milestone._id}:${event}`,
    type,
    category: 'contracts',
    title,
    body,
    actionUrl: `/dashboard/projects/${project._id}`,
    entityType: 'project',
    entityId: project._id,
    metadata: {
      milestoneId: milestone._id,
      milestoneStatus: milestone.status,
      ...(submission ? { submissionId: submission._id, submissionVersion: submission.version } : {}),
    },
  }).catch(() => null);
}

async function ensureActiveContract(project) {
  const contract = await Contract.findById(project.contract).select('status');
  if (!contract) throw ApiError.notFound('Project contract not found');
  if (contract.status !== CONTRACT_STATUSES.ACTIVE) {
    throw ApiError.badRequest(`Milestone work is unavailable while the contract is ${contract.status}`);
  }
  return contract;
}

async function milestoneActionContext(user, projectId, milestoneId) {
  const project = await Project.findById(projectId);
  if (!project) throw ApiError.notFound('Project not found');
  const roles = ensureParticipant(project, user);
  const milestone = await Milestone.findOne({ _id: milestoneId, project: project._id });
  if (!milestone) throw ApiError.notFound('Milestone not found');
  await ensureActiveContract(project);
  return { project, milestone, ...roles };
}

async function milestonesWithSubmissions(projectId) {
  const milestones = await Milestone.find({ project: projectId }).sort({ order: 1 }).lean();
  if (milestones.length === 0) return [];
  const milestoneIds = milestones.map((milestone) => milestone._id);
  const submissions = await WorkSubmission.find({ milestone: mongoose.trusted({ $in: milestoneIds }) })
    .sort({ milestone: 1, version: -1 })
    .populate('submittedBy', 'name role')
    .populate('reviewedBy', 'name role')
    .lean();
  const grouped = new Map();
  for (const submission of submissions) {
    const key = id(submission.milestone);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(submission);
  }
  return milestones.map((milestone) => ({ ...milestone, submissions: grouped.get(id(milestone)) || [] }));
}

async function reflectApprovedProgress(project, milestone, actor) {
  const [total, approved] = await Promise.all([
    Milestone.countDocuments({ project: project._id }),
    Milestone.countDocuments({ project: project._id, status: MILESTONE_STATUSES.APPROVED }),
  ]);
  if (total === 0) return;
  const target = Math.min(99, Math.round((approved / total) * 100));
  const current = await Project.findById(project._id).select('progress');
  if (!current || target <= current.progress) return;
  const now = new Date();
  await Project.findOneAndUpdate(
    { _id: current._id, progress: current.progress },
    {
      $set: { progress: target, progressUpdatedAt: now, progressUpdatedBy: actor._id },
      $push: {
        progressHistory: {
          $each: [{
            from: current.progress,
            to: target,
            actor: actor._id,
            actorRole: 'client',
            note: `Approved milestone: ${milestone.title}`,
            at: now,
          }],
          $slice: -100,
        },
      },
    },
    { runValidators: true },
  );
}

export const projectService = {
  async ensureMilestonesForProject(project, contract) {
    const existing = await Milestone.find({ project: project._id }).sort({ order: 1 });
    if (existing.length > 0 || contract.budget?.type !== 'fixed') return existing;

    const terms = contract.milestones?.length
      ? contract.milestones
      : [{
        _id: null,
        title: contract.title || 'Project delivery',
        amount: contract.budget.amount,
        dueDate: contract.endDate || null,
        description: 'Complete the accepted fixed-price project scope.',
      }];
    try {
      return await Milestone.insertMany(terms.map((item, order) => ({
        project: project._id,
        contract: contract._id,
        sourceMilestoneId: item._id || item.sourceMilestoneId || null,
        title: item.title,
        description: item.description || '',
        amount: item.amount,
        dueDate: item.dueDate || null,
        order,
      })));
    } catch (error) {
      if (error?.code !== 11000) throw error;
      return Milestone.find({ project: project._id }).sort({ order: 1 });
    }
  },

  async ensureForContract(contract, actor = null) {
    await Promise.all([Project.init(), Milestone.init(), WorkSubmission.init()]);
    const existing = await Project.findOne({ contract: contract._id });
    if (existing) {
      if (id(contract.project) !== id(existing)) {
        await Contract.updateOne({ _id: contract._id }, { $set: { project: existing._id } });
        contract.project = existing._id;
      }
      await this.ensureMilestonesForProject(existing, contract);
      return existing;
    }

    const now = contract.activatedAt || new Date();
    let project;
    let created = false;
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
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      project = await Project.findOne({ $or: [{ contract: contract._id }, { job: contract.job }] });
      if (!project || id(project.contract) !== id(contract)) {
        throw ApiError.conflict('A different project workspace already exists for this job');
      }
    }
    try {
      await this.ensureMilestonesForProject(project, contract);
    } catch (error) {
      if (created) await Promise.all([
        Milestone.deleteMany({ project: project._id }),
        Project.deleteOne({ _id: project._id }),
      ]);
      throw error;
    }
    await Contract.updateOne({ _id: contract._id }, { $set: { project: project._id } });
    contract.project = project._id;
    return project;
  },

  async list(user, { page = 1, limit = 20 }) {
    const participantFilter = mongoose.trusted({ $or: [{ client: user._id }, { freelancer: user._id }] });
    const contracts = await Contract.find(participantFilter).select('_id offer job client freelancer title budget milestones endDate status activatedAt project');
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
    await this.ensureMilestonesForProject(project, project.contract);
    const [conversation, milestones] = await Promise.all([
      Conversation.findOne({ contextType: 'offer', contextId: project.offer }).select('_id'),
      milestonesWithSubmissions(project._id),
    ]);
    return present(project, conversation?._id || null, milestones);
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

  async startMilestone(user, projectId, milestoneId) {
    const { project, milestone, isFreelancer } = await milestoneActionContext(user, projectId, milestoneId);
    if (!isFreelancer) throw ApiError.forbidden('Only the freelancer can start a milestone');
    if (milestone.status !== MILESTONE_STATUSES.PENDING) {
      throw ApiError.badRequest('Only a pending milestone can be started');
    }
    const updated = await Milestone.findOneAndUpdate(
      { _id: milestone._id, status: MILESTONE_STATUSES.PENDING },
      { $set: { status: MILESTONE_STATUSES.IN_PROGRESS, startedAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.conflict('The milestone changed before it could be started');
    await publishMilestoneNotification({
      project,
      recipient: project.client,
      actor: user,
      event: `started:${updated.startedAt.toISOString()}`,
      type: 'milestone_started',
      title: 'Milestone started',
      body: `${user.name} started “${updated.title}”.`,
      milestone: updated,
    });
    return this.get(user, project._id);
  },

  async submitWork(user, projectId, milestoneId, { description, links = [] }) {
    const { project, milestone, isFreelancer } = await milestoneActionContext(user, projectId, milestoneId);
    if (!isFreelancer) throw ApiError.forbidden('Only the freelancer can submit milestone work');
    if (![MILESTONE_STATUSES.IN_PROGRESS, MILESTONE_STATUSES.REVISION_REQUESTED].includes(milestone.status)) {
      throw ApiError.badRequest('This milestone is not ready for a submission');
    }
    const last = await WorkSubmission.findOne({ milestone: milestone._id }).sort({ version: -1 }).select('version');
    let submission;
    try {
      submission = await WorkSubmission.create({
        milestone: milestone._id,
        project: project._id,
        contract: project.contract,
        submittedBy: user._id,
        description,
        links,
        version: (last?.version || 0) + 1,
      });
    } catch (error) {
      if (error?.code === 11000) throw ApiError.conflict('A submission was already created for this milestone version');
      throw error;
    }
    const updated = await Milestone.findOneAndUpdate(
      { _id: milestone._id, status: milestone.status },
      { $set: { status: MILESTONE_STATUSES.SUBMITTED, submittedAt: submission.submittedAt } },
      { new: true, runValidators: true },
    );
    if (!updated) {
      await WorkSubmission.deleteOne({ _id: submission._id });
      throw ApiError.conflict('The milestone changed before the submission was saved');
    }
    await publishMilestoneNotification({
      project,
      recipient: project.client,
      actor: user,
      event: `submitted:${submission._id}`,
      type: 'milestone_work_submitted',
      title: 'Work submitted for review',
      body: `${user.name} submitted version ${submission.version} for “${updated.title}”.`,
      milestone: updated,
      submission,
    });
    return this.get(user, project._id);
  },

  async reviewSubmission(user, projectId, milestoneId, submissionId, { decision, feedback = '' }) {
    const { project, milestone, isClient } = await milestoneActionContext(user, projectId, milestoneId);
    if (!isClient) throw ApiError.forbidden('Only the client can review milestone work');
    if (milestone.status !== MILESTONE_STATUSES.SUBMITTED) {
      throw ApiError.badRequest('This milestone is not awaiting review');
    }
    const submission = await WorkSubmission.findOne({
      _id: submissionId,
      milestone: milestone._id,
      project: project._id,
    });
    if (!submission) throw ApiError.notFound('Work submission not found');
    if (submission.status !== SUBMISSION_STATUSES.SUBMITTED) {
      throw ApiError.badRequest('This submission has already been reviewed');
    }
    const latestSubmission = await WorkSubmission.findOne({ milestone: milestone._id }).sort({ version: -1 }).select('_id');
    if (id(latestSubmission) !== id(submission)) {
      throw ApiError.badRequest('Only the latest submission can be reviewed');
    }
    if (decision === 'revision' && feedback.trim().length < 3) {
      throw ApiError.badRequest('Revision feedback is required');
    }

    const now = new Date();
    const submissionStatus = decision === 'approve' ? SUBMISSION_STATUSES.APPROVED : SUBMISSION_STATUSES.REVISION_REQUESTED;
    const milestoneStatus = decision === 'approve' ? MILESTONE_STATUSES.APPROVED : MILESTONE_STATUSES.REVISION_REQUESTED;
    const reviewed = await WorkSubmission.findOneAndUpdate(
      { _id: submission._id, status: SUBMISSION_STATUSES.SUBMITTED },
      { $set: { status: submissionStatus, feedback, reviewedAt: now, reviewedBy: user._id } },
      { new: true, runValidators: true },
    );
    if (!reviewed) throw ApiError.conflict('The submission changed before your review was saved');
    const updated = await Milestone.findOneAndUpdate(
      { _id: milestone._id, status: MILESTONE_STATUSES.SUBMITTED },
      {
        $set: {
          status: milestoneStatus,
          ...(decision === 'approve' ? { approvedAt: now } : { approvedAt: null }),
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) {
      await WorkSubmission.updateOne(
        { _id: reviewed._id, status: submissionStatus, reviewedAt: now },
        { $set: { status: SUBMISSION_STATUSES.SUBMITTED, feedback: '', reviewedAt: null, reviewedBy: null } },
      );
      throw ApiError.conflict('The milestone changed before your review was saved');
    }
    if (decision === 'approve') await reflectApprovedProgress(project, updated, user);
    await publishMilestoneNotification({
      project,
      recipient: project.freelancer,
      actor: user,
      event: `${decision}:${reviewed._id}`,
      type: decision === 'approve' ? 'milestone_work_approved' : 'milestone_revision_requested',
      title: decision === 'approve' ? 'Milestone approved' : 'Revision requested',
      body: decision === 'approve'
        ? `${user.name} approved “${updated.title}”.`
        : `${user.name} requested revisions for “${updated.title}”.`,
      milestone: updated,
      submission: reviewed,
    });
    return this.get(user, project._id);
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
