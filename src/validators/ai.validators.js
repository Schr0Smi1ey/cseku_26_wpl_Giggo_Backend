import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const analyzeCvSchema = z.object({
  text: z.string().trim().min(20).max(100000).optional(),
  force: z.boolean().optional().default(false),
}).strict();

export const analysisQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();

export const analysisIdSchema = z.object({ id: objectId }).strict();
