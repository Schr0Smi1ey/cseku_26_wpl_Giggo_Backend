import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const projectIdParamsSchema = z.object({ id: objectId }).strict();
export const milestoneParamsSchema = z.object({ id: objectId, milestoneId: objectId }).strict();
export const submissionParamsSchema = z.object({ id: objectId, milestoneId: objectId, submissionId: objectId }).strict();
export const projectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();
export const projectProgressSchema = z.object({
  progress: z.coerce.number().int().min(1).max(99),
  note: z.string().trim().min(3).max(500),
}).strict();
export const workSubmissionSchema = z.object({
  description: z.string().trim().min(3).max(5000),
  links: z.array(z.string().trim().url().max(1000)).max(10).optional().default([]),
}).strict();
export const submissionReviewSchema = z.object({
  decision: z.enum(['approve', 'revision']),
  feedback: z.string().trim().max(2000).optional().default(''),
}).strict();
