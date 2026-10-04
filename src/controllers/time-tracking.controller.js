import { timeTrackingService } from '../services/time-tracking.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const timeTrackingController = {
  list: asyncHandler(async (req, res) => ok(res, await timeTrackingService.list(req.user, req.params.id, req.query))),
  startTimer: asyncHandler(async (req, res) => ok(res, { timer: await timeTrackingService.startTimer(req.user, req.params.id, req.body) }, 'Timer started', 201)),
  heartbeat: asyncHandler(async (req, res) => ok(res, { timer: await timeTrackingService.heartbeat(req.user, req.params.id, req.params.timerId) })),
  stopTimer: asyncHandler(async (req, res) => ok(res, { entry: await timeTrackingService.stopTimer(req.user, req.params.id, req.params.timerId, req.body) }, 'Timer stopped')),
  createManualEntry: asyncHandler(async (req, res) => ok(res, { entry: await timeTrackingService.createManualEntry(req.user, req.params.id, req.body) }, 'Time entry added', 201)),
  updateEntry: asyncHandler(async (req, res) => ok(res, { entry: await timeTrackingService.updateEntry(req.user, req.params.id, req.params.entryId, req.body) }, 'Time entry updated')),
  deleteEntry: asyncHandler(async (req, res) => ok(res, { entry: await timeTrackingService.deleteEntry(req.user, req.params.id, req.params.entryId, req.body) }, 'Time entry deleted')),
};
