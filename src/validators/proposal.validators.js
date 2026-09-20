import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const text = (max) => z.string().trim().max(max);
const calendarDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid due date').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid due date');

const bidSchema = z.object({
  amount: z.coerce.number().finite().positive().max(10_000_000),
  type: z.enum(['fixed', 'hourly']),
  currency: z.string().trim().length(3).regex(/^[a-z]{3}$/i, 'Use a three-letter currency code').transform((value) => value.toUpperCase()),
}).strict();

const milestoneSchema = z.object({
  title: text(120).min(2),
  amount: z.coerce.number().finite().positive().max(10_000_000),
  dueDate: calendarDate.optional(),
  description: text(1000).optional(),
}).strict();

export const createProposalSchema = z.object({
  job: objectId,
  coverLetter: text(5000).min(100, 'Cover letter must be at least 100 characters'),
  bid: bidSchema,
  estimatedDays: z.coerce.number().int().min(1).max(3650),
  milestones: z.array(milestoneSchema).max(10).optional().default([]),
  aiAssisted: z.boolean().optional().default(false),
}).strict();

export const proposalJobParamsSchema = z.object({ jobId: objectId }).strict();

export const proposalIdParamsSchema = z.object({ id: objectId }).strict();

export const updateProposalSchema = z.object({
  coverLetter: text(5000).min(100, 'Cover letter must be at least 100 characters').optional(),
  bid: bidSchema.optional(),
  estimatedDays: z.coerce.number().int().min(1).max(3650).optional(),
  milestones: z.array(milestoneSchema).max(10).optional(),
  aiAssisted: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one proposal field');

const proposalStatus = z.enum(['submitted', 'shortlisted', 'rejected', 'withdrawn', 'accepted']);

export const myProposalsQuerySchema = z.object({
  job: objectId.optional(),
  status: proposalStatus.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
}).strict();

export const receivedProposalsQuerySchema = myProposalsQuerySchema.omit({ job: true }).extend({
  job: objectId.optional(),
  sort: z.enum(['recent', 'bid_asc', 'bid_desc']).optional().default('recent'),
}).strict();

export const proposalDecisionSchema = z.object({
  decision: z.enum(['shortlist', 'reject', 'reconsider']),
  reviewNote: text(1000).optional(),
}).strict();
