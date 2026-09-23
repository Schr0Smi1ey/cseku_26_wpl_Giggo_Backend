import { projectService } from '../services/project.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

export const projectController = {
  list: asyncHandler(async (req, res) => ok(res, await projectService.list(req.user, req.query))),
  getOne: asyncHandler(async (req, res) => ok(res, { project: await projectService.get(req.user, req.params.id) })),
  updateProgress: asyncHandler(async (req, res) => ok(res, { project: await projectService.updateProgress(req.user, req.params.id, req.body) }, 'Project progress updated')),
  startMilestone: asyncHandler(async (req, res) => ok(res, { project: await projectService.startMilestone(req.user, req.params.id, req.params.milestoneId) }, 'Milestone started')),
  submitWork: asyncHandler(async (req, res) => ok(res, { project: await projectService.submitWork(req.user, req.params.id, req.params.milestoneId, req.body) }, 'Work submitted for review')),
  reviewSubmission: asyncHandler(async (req, res) => ok(res, { project: await projectService.reviewSubmission(req.user, req.params.id, req.params.milestoneId, req.params.submissionId, req.body) }, req.body.decision === 'approve' ? 'Milestone approved' : 'Revision requested')),
};
