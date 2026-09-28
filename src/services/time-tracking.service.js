import mongoose from 'mongoose';
import { ActiveTimer, TIMER_STATUSES } from '../models/ActiveTimer.js';
import { Contract, CONTRACT_STATUSES } from '../models/Contract.js';
import { Project } from '../models/Project.js';
import {
  TimeEntry,
  TIME_ENTRY_SOURCES,
  TIME_ENTRY_STATUSES,
} from '../models/TimeEntry.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from './notification.service.js';

const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const HEARTBEAT_GRACE_MS = 2 * 60 * 1000;
const MANUAL_ENTRY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUERY_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

const id = (value) => String(value?._id || value || '');
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const durationMinutes = (startedAt, endedAt) => Math.max(1, Math.floor((endedAt.getTime() - startedAt.getTime()) / 60_000));

function previousSnapshot(entry) {
  return {
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    durationMinutes: entry.durationMinutes,
    description: entry.description,
    status: entry.status,
  };
}

async function context(user, projectId, { write = false, allowInactive = false } = {}) {
  const project = await Project.findById(projectId);
  if (!project) throw ApiError.notFound('Project not found');
  const isClient = id(project.client) === id(user);
  const isFreelancer = id(project.freelancer) === id(user);
  if (!isClient && !isFreelancer) throw ApiError.notFound('Project not found');
  const contract = await Contract.findById(project.contract).select('status budget activatedAt pausedAt completedAt cancelledAt client freelancer');
  if (!contract) throw ApiError.notFound('Project contract not found');
  if (contract.budget.type !== 'hourly') throw ApiError.badRequest('Time tracking is available only for hourly contracts');
  if (write && !isFreelancer) throw ApiError.forbidden('Only the freelancer can record hourly work');
  if (write && !allowInactive && contract.status !== CONTRACT_STATUSES.ACTIVE) {
    throw ApiError.badRequest(`Time tracking is unavailable while the contract is ${contract.status}`);
  }
  return { project, contract, isClient, isFreelancer };
}

function assertTimeRange(startedAt, endedAt, contract, { manual = false } = {}) {
  const now = Date.now();
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime()) || endedAt <= startedAt) {
    throw ApiError.badRequest('End time must be after start time');
  }
  if (endedAt.getTime() > now + 5_000) throw ApiError.badRequest('Time entries cannot extend into the future');
  if (endedAt.getTime() - startedAt.getTime() > MAX_SESSION_MS) {
    throw ApiError.badRequest('A time entry cannot exceed 12 hours');
  }
  if (startedAt < contract.activatedAt) throw ApiError.badRequest('Time cannot be recorded before the contract became active');
  if (manual && startedAt.getTime() < now - MANUAL_ENTRY_LOOKBACK_MS) {
    throw ApiError.badRequest('Manual time can only be added for the last 30 days');
  }
}

async function ensureNoOverlap(freelancerId, startedAt, endedAt, { excludeEntryId = null } = {}) {
  const entryFilter = {
    freelancer: freelancerId,
    status: TIME_ENTRY_STATUSES.COMPLETED,
    startedAt: mongoose.trusted({ $lt: endedAt }),
    endedAt: mongoose.trusted({ $gt: startedAt }),
  };
  if (excludeEntryId) entryFilter._id = mongoose.trusted({ $ne: excludeEntryId });
  const [entry, timer] = await Promise.all([
    TimeEntry.findOne(entryFilter).select('_id'),
    ActiveTimer.findOne({
      freelancer: freelancerId,
      active: true,
      startedAt: mongoose.trusted({ $lt: endedAt }),
    }).select('_id'),
  ]);
  if (entry || timer) throw ApiError.conflict('This time overlaps another recorded or running work session');
}

async function publishTimeNotification({ project, user, entry, action }) {
  const labels = {
    recorded: ['Hourly work recorded', `${user.name} recorded ${entry.durationMinutes} minutes of work.`],
    updated: ['Hourly work updated', `${user.name} updated a work-diary entry.`],
    deleted: ['Hourly work removed', `${user.name} removed a work-diary entry.`],
  };
  const [title, body] = labels[action];
  return notificationService.publish({
    recipient: project.client,
    actor: user._id,
    eventKey: `project:${project._id}:time:${entry._id}:${action}:r${entry.revision}`,
    type: `hourly_time_${action}`,
    category: 'contracts',
    title,
    body,
    actionUrl: `/dashboard/projects/${project._id}`,
    entityType: 'time_entry',
    entityId: entry._id,
    metadata: { projectId: project._id, contractId: project.contract, durationMinutes: entry.durationMinutes },
  }).catch(() => null);
}

async function ownedEntry(user, projectId, entryId) {
  const ctx = await context(user, projectId, { write: true });
  const entry = await TimeEntry.findOne({ _id: entryId, project: ctx.project._id, freelancer: user._id });
  if (!entry) throw ApiError.notFound('Time entry not found');
  if (entry.status === TIME_ENTRY_STATUSES.DELETED) throw ApiError.badRequest('This time entry has already been deleted');
  if (Date.now() - entry.endedAt.getTime() > EDIT_WINDOW_MS) {
    throw ApiError.badRequest('Time entries can only be changed within seven days');
  }
  return { ...ctx, entry };
}

export const timeTrackingService = {
  async list(user, projectId, { from, to, page = 1, limit = 20 }) {
    const ctx = await context(user, projectId);
    const upper = to ? new Date(to) : new Date();
    const lower = from ? new Date(from) : new Date(upper.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(lower.getTime()) || !Number.isFinite(upper.getTime()) || upper <= lower) {
      throw ApiError.badRequest('The work-diary date range is invalid');
    }
    if (upper.getTime() - lower.getTime() > MAX_QUERY_RANGE_MS) {
      throw ApiError.badRequest('The work diary can be queried for at most 90 days at a time');
    }
    const filter = {
      project: ctx.project._id,
      startedAt: mongoose.trusted({ $lt: upper }),
      endedAt: mongoose.trusted({ $gt: lower }),
    };
    const [items, total, summaryRows, activeTimer] = await Promise.all([
      TimeEntry.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('revisions.actor', 'name role')
        .lean(),
      TimeEntry.countDocuments(filter),
      TimeEntry.find({ ...filter, status: TIME_ENTRY_STATUSES.COMPLETED }).select('startedAt durationMinutes estimatedAmount').lean(),
      ctx.isFreelancer
        ? ActiveTimer.findOne({ project: ctx.project._id, freelancer: user._id, active: true }).lean()
        : null,
    ]);
    const byDay = new Map();
    for (const entry of summaryRows) {
      const day = entry.startedAt.toISOString().slice(0, 10);
      const current = byDay.get(day) || { date: day, minutes: 0, estimatedAmount: 0 };
      current.minutes += entry.durationMinutes;
      current.estimatedAmount = roundMoney(current.estimatedAmount + entry.estimatedAmount);
      byDay.set(day, current);
    }
    const daily = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
    const totalMinutes = daily.reduce((sum, row) => sum + row.minutes, 0);
    const estimatedAmount = roundMoney(daily.reduce((sum, row) => sum + row.estimatedAmount, 0));
    return {
      items,
      activeTimer: activeTimer ? {
        ...activeTimer,
        stale: Date.now() - activeTimer.lastHeartbeatAt.getTime() > HEARTBEAT_GRACE_MS,
      } : null,
      summary: {
        from: lower,
        to: upper,
        totalMinutes,
        estimatedAmount,
        currency: ctx.contract.budget.currency,
        hourlyRate: ctx.contract.budget.amount,
        daily,
      },
      policy: { maxSessionMinutes: 720, editWindowDays: 7, manualLookbackDays: 30 },
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async startTimer(user, projectId, { description, idempotencyKey }) {
    const { project, contract } = await context(user, projectId, { write: true });
    await Promise.all([ActiveTimer.init(), TimeEntry.init()]);
    const retried = await ActiveTimer.findOne({ freelancer: user._id, startIdempotencyKey: idempotencyKey });
    if (retried) {
      if (id(retried.project) !== id(project)) throw ApiError.conflict('This timer request key was already used');
      return retried;
    }
    try {
      return await ActiveTimer.create({
        freelancer: user._id,
        contract: contract._id,
        project: project._id,
        description,
        startIdempotencyKey: idempotencyKey,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const sameRequest = await ActiveTimer.findOne({ freelancer: user._id, startIdempotencyKey: idempotencyKey });
      if (sameRequest && id(sameRequest.project) === id(project)) return sameRequest;
      throw ApiError.conflict('Stop your current timer before starting another one');
    }
  },

  async heartbeat(user, projectId, timerId) {
    await context(user, projectId, { write: true });
    const timer = await ActiveTimer.findOne({ _id: timerId, project: projectId, freelancer: user._id, active: true });
    if (!timer) throw ApiError.notFound('Running timer not found');
    if (Date.now() - timer.startedAt.getTime() >= MAX_SESSION_MS) {
      throw ApiError.badRequest('This timer reached the 12-hour limit and must be stopped');
    }
    const updated = await ActiveTimer.findOneAndUpdate(
      { _id: timer._id, status: TIMER_STATUSES.RUNNING, active: true },
      { $set: { lastHeartbeatAt: new Date() } },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.conflict('The timer changed before the heartbeat was saved');
    return updated;
  },

  async stopTimer(user, projectId, timerId, { description } = {}) {
    const { project, contract } = await context(user, projectId, { write: true, allowInactive: true });
    const timer = await ActiveTimer.findOne({ _id: timerId, project: project._id, freelancer: user._id });
    if (!timer) throw ApiError.notFound('Timer not found');
    const existingEntry = await TimeEntry.findOne({ timer: timer._id });
    if (existingEntry) {
      if (timer.active || timer.status !== TIMER_STATUSES.STOPPED) {
        await ActiveTimer.updateOne(
          { _id: timer._id },
          { $set: { active: false, status: TIMER_STATUSES.STOPPED, stoppedAt: existingEntry.endedAt, entry: existingEntry._id } },
        );
      }
      return existingEntry;
    }
    const claimed = timer.status === TIMER_STATUSES.STOPPING
      ? timer
      : await ActiveTimer.findOneAndUpdate(
        { _id: timer._id, active: true, status: TIMER_STATUSES.RUNNING },
        { $set: { status: TIMER_STATUSES.STOPPING } },
        { new: true, runValidators: true },
      );
    if (!claimed) throw ApiError.conflict('The timer is already being stopped');

    const now = new Date();
    const hardEnd = new Date(claimed.startedAt.getTime() + MAX_SESSION_MS);
    const heartbeatEnd = new Date(claimed.lastHeartbeatAt.getTime() + HEARTBEAT_GRACE_MS);
    const transitionAt = contract.status === CONTRACT_STATUSES.PAUSED
      ? contract.pausedAt
      : contract.status === CONTRACT_STATUSES.COMPLETED
        ? contract.completedAt
        : contract.status === CONTRACT_STATUSES.CANCELLED
          ? contract.cancelledAt
          : null;
    const endedAt = new Date(Math.min(
      now.getTime(),
      hardEnd.getTime(),
      heartbeatEnd.getTime(),
      transitionAt?.getTime?.() || Number.POSITIVE_INFINITY,
    ));
    const minutes = durationMinutes(claimed.startedAt, endedAt);
    let entry;
    try {
      entry = await TimeEntry.create({
        freelancer: user._id,
        contract: contract._id,
        project: project._id,
        timer: claimed._id,
        startedAt: claimed.startedAt,
        endedAt,
        durationMinutes: minutes,
        description: description || claimed.description,
        source: TIME_ENTRY_SOURCES.TIMER,
        hourlyRate: contract.budget.amount,
        estimatedAmount: roundMoney((minutes / 60) * contract.budget.amount),
        currency: contract.budget.currency,
        idempotencyKey: `timer:${claimed._id}`,
      });
      await ActiveTimer.updateOne(
        { _id: claimed._id, status: TIMER_STATUSES.STOPPING },
        { $set: { active: false, status: TIMER_STATUSES.STOPPED, stoppedAt: endedAt, entry: entry._id } },
        { runValidators: true },
      );
    } catch (error) {
      if (error?.code === 11000) entry = await TimeEntry.findOne({ timer: claimed._id });
      if (!entry) {
        await ActiveTimer.updateOne(
          { _id: claimed._id, status: TIMER_STATUSES.STOPPING },
          { $set: { status: TIMER_STATUSES.RUNNING } },
        );
        throw error;
      }
    }
    await publishTimeNotification({ project, user, entry, action: 'recorded' });
    return entry;
  },

  async createManualEntry(user, projectId, { startedAt: startValue, endedAt: endValue, description, idempotencyKey }) {
    const { project, contract } = await context(user, projectId, { write: true });
    await TimeEntry.init();
    const retried = await TimeEntry.findOne({ freelancer: user._id, idempotencyKey });
    if (retried) {
      if (id(retried.project) !== id(project)) throw ApiError.conflict('This time-entry request key was already used');
      return retried;
    }
    const startedAt = new Date(startValue);
    const endedAt = new Date(endValue);
    assertTimeRange(startedAt, endedAt, contract, { manual: true });
    await ensureNoOverlap(user._id, startedAt, endedAt);
    const minutes = durationMinutes(startedAt, endedAt);
    let entry;
    try {
      entry = await TimeEntry.create({
        freelancer: user._id,
        contract: contract._id,
        project: project._id,
        startedAt,
        endedAt,
        durationMinutes: minutes,
        description,
        source: TIME_ENTRY_SOURCES.MANUAL,
        hourlyRate: contract.budget.amount,
        estimatedAmount: roundMoney((minutes / 60) * contract.budget.amount),
        currency: contract.budget.currency,
        idempotencyKey,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      entry = await TimeEntry.findOne({ freelancer: user._id, idempotencyKey });
      if (!entry || id(entry.project) !== id(project)) throw ApiError.conflict('This time-entry request key was already used');
    }
    await publishTimeNotification({ project, user, entry, action: 'recorded' });
    return entry;
  },

  async updateEntry(user, projectId, entryId, payload) {
    const { project, contract, entry } = await ownedEntry(user, projectId, entryId);
    if (payload.revision !== entry.revision) throw ApiError.conflict('The time entry changed before your update was saved');
    if (entry.source === TIME_ENTRY_SOURCES.TIMER && (payload.startedAt || payload.endedAt)) {
      throw ApiError.badRequest('Timer entry start and end times cannot be edited');
    }
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : entry.startedAt;
    const endedAt = payload.endedAt ? new Date(payload.endedAt) : entry.endedAt;
    assertTimeRange(startedAt, endedAt, contract, { manual: entry.source === TIME_ENTRY_SOURCES.MANUAL });
    if (entry.source === TIME_ENTRY_SOURCES.MANUAL && (payload.startedAt || payload.endedAt)) {
      await ensureNoOverlap(user._id, startedAt, endedAt, { excludeEntryId: entry._id });
    }
    const minutes = durationMinutes(startedAt, endedAt);
    const nextRevision = entry.revision + 1;
    const updated = await TimeEntry.findOneAndUpdate(
      { _id: entry._id, revision: entry.revision, status: TIME_ENTRY_STATUSES.COMPLETED },
      {
        $set: {
          startedAt,
          endedAt,
          durationMinutes: minutes,
          description: payload.description || entry.description,
          estimatedAmount: roundMoney((minutes / 60) * entry.hourlyRate),
          revision: nextRevision,
        },
        $push: {
          revisions: {
            $each: [{ revision: nextRevision, action: 'updated', actor: user._id, reason: payload.reason, previous: previousSnapshot(entry), at: new Date() }],
            $slice: -50,
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) throw ApiError.conflict('The time entry changed before your update was saved');
    await publishTimeNotification({ project, user, entry: updated, action: 'updated' });
    return updated;
  },

  async deleteEntry(user, projectId, entryId, { revision, reason }) {
    const { project, entry } = await ownedEntry(user, projectId, entryId);
    if (revision !== entry.revision) throw ApiError.conflict('The time entry changed before your deletion was saved');
    const nextRevision = entry.revision + 1;
    const now = new Date();
    const deleted = await TimeEntry.findOneAndUpdate(
      { _id: entry._id, revision: entry.revision, status: TIME_ENTRY_STATUSES.COMPLETED },
      {
        $set: {
          status: TIME_ENTRY_STATUSES.DELETED,
          revision: nextRevision,
          deletedAt: now,
          deletedBy: user._id,
          deletionReason: reason,
        },
        $push: {
          revisions: {
            $each: [{ revision: nextRevision, action: 'deleted', actor: user._id, reason, previous: previousSnapshot(entry), at: now }],
            $slice: -50,
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!deleted) throw ApiError.conflict('The time entry changed before your deletion was saved');
    await publishTimeNotification({ project, user, entry: deleted, action: 'deleted' });
    return deleted;
  },
};
