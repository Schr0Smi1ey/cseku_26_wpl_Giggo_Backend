import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const contractIdParamsSchema = z.object({ id: objectId }).strict();
export const contractsQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();
export const contractTransitionSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'cancelled']),
  note: z.string().trim().max(1000).optional().default(''),
}).strict();
