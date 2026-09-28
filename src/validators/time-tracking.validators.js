import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const idempotencyKey = z.string().trim().min(8).max(120);
const description = z.string().trim().min(3).max(500);
const reason = z.string().trim().min(3).max(500);

export const timerParamsSchema = z.object({ id: objectId, timerId: objectId }).strict();
export const timeEntryParamsSchema = z.object({ id: objectId, entryId: objectId }).strict();

export const timeEntriesQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();

export const startTimerSchema = z.object({
  description,
  idempotencyKey,
}).strict();

export const stopTimerSchema = z.object({
  description: description.optional(),
}).strict();

export const manualTimeEntrySchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  description,
  idempotencyKey,
}).strict();

export const updateTimeEntrySchema = z.object({
  revision: z.coerce.number().int().min(1),
  reason,
  description: description.optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional(),
}).strict().refine(
  (value) => value.description !== undefined || value.startedAt !== undefined || value.endedAt !== undefined,
  { message: 'At least one time entry field must be changed' },
);

export const deleteTimeEntrySchema = z.object({
  revision: z.coerce.number().int().min(1),
  reason,
}).strict();
