import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const projectIdParamsSchema = z.object({ id: objectId }).strict();
export const projectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();
export const projectProgressSchema = z.object({
  progress: z.coerce.number().int().min(1).max(99),
  note: z.string().trim().min(3).max(500),
}).strict();
