import { Router } from 'express';
import { projectController } from '../controllers/project.controller.js';
import { timeTrackingController } from '../controllers/time-tracking.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { ROLES } from '../models/User.js';
import {
  milestoneParamsSchema,
  projectIdParamsSchema,
  projectProgressSchema,
  projectsQuerySchema,
  submissionParamsSchema,
  submissionReviewSchema,
  workSubmissionSchema,
} from '../validators/project.validators.js';
import {
  deleteTimeEntrySchema,
  manualTimeEntrySchema,
  startTimerSchema,
  stopTimerSchema,
  timeEntriesQuerySchema,
  timeEntryParamsSchema,
  timerParamsSchema,
  updateTimeEntrySchema,
} from '../validators/time-tracking.validators.js';

const router = Router();
const validatePart = (part, schema) => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) return next(result.error);
  req[part] = result.data;
  return next();
};

router.use(requireAuth);
router.use(requireRole(ROLES.CLIENT, ROLES.FREELANCER));
router.get('/', validatePart('query', projectsQuerySchema), projectController.list);
router.get('/:id', validatePart('params', projectIdParamsSchema), projectController.getOne);
router.patch('/:id/progress', validatePart('params', projectIdParamsSchema), validate(projectProgressSchema), projectController.updateProgress);
router.post('/:id/milestones/:milestoneId/start', validatePart('params', milestoneParamsSchema), projectController.startMilestone);
router.post('/:id/milestones/:milestoneId/submissions', validatePart('params', milestoneParamsSchema), validate(workSubmissionSchema), projectController.submitWork);
router.post('/:id/milestones/:milestoneId/submissions/:submissionId/review', validatePart('params', submissionParamsSchema), validate(submissionReviewSchema), projectController.reviewSubmission);
router.get('/:id/time', validatePart('params', projectIdParamsSchema), validatePart('query', timeEntriesQuerySchema), timeTrackingController.list);
router.post('/:id/time/timers', validatePart('params', projectIdParamsSchema), validate(startTimerSchema), timeTrackingController.startTimer);
router.post('/:id/time/timers/:timerId/heartbeat', validatePart('params', timerParamsSchema), timeTrackingController.heartbeat);
router.post('/:id/time/timers/:timerId/stop', validatePart('params', timerParamsSchema), validate(stopTimerSchema), timeTrackingController.stopTimer);
router.post('/:id/time/entries', validatePart('params', projectIdParamsSchema), validate(manualTimeEntrySchema), timeTrackingController.createManualEntry);
router.patch('/:id/time/entries/:entryId', validatePart('params', timeEntryParamsSchema), validate(updateTimeEntrySchema), timeTrackingController.updateEntry);
router.delete('/:id/time/entries/:entryId', validatePart('params', timeEntryParamsSchema), validate(deleteTimeEntrySchema), timeTrackingController.deleteEntry);

export default router;
