import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const text = (max) => z.string().trim().max(max);
const calendarDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid date');

const budgetSchema = z.object({
  amount: z.coerce.number().finite().positive().max(10_000_000),
  type: z.enum(['fixed', 'hourly']),
  currency: z.string().trim().length(3).regex(/^[a-z]{3}$/i, 'Use a three-letter currency code').transform((value) => value.toUpperCase()),
}).strict();

const milestoneSchema = z.object({
  title: text(120).min(2),
  amount: z.coerce.number().finite().positive().max(10_000_000),
  dueDate: calendarDate.optional(),
  description: text(1000).optional().default(''),
}).strict();

const termsShape = {
  title: text(150).min(2),
  description: text(5000).min(20, 'Description must be at least 20 characters'),
  budget: budgetSchema,
  estimatedDays: z.coerce.number().int().min(1).max(3650),
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional(),
  expiresAt: calendarDate.optional(),
  terms: text(5000).optional().default(''),
  milestones: z.array(milestoneSchema).max(10).optional().default([]),
};

export const offerTermsSchema = z.object(termsShape).strict();
export const createOfferSchema = z.object({ proposal: objectId, ...termsShape }).strict();
export const updateOfferSchema = z.object(termsShape).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one offer field');
export const offerIdParamsSchema = z.object({ id: objectId }).strict();
export const offersQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'changes_requested', 'revising', 'accepted', 'rejected', 'withdrawn']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();
export const requestOfferChangesSchema = z.object({ message: text(1000).min(3) }).strict();
export const offerMessageSchema = z.object({ message: text(1000).min(1) }).strict();
export const acceptOfferSchema = z.object({ revision: z.coerce.number().int().min(1) }).strict();
