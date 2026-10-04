import { z } from 'zod';

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const upper = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const lower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

const provider = z.preprocess(upper, z.enum(['BKASH_SIMULATED', 'NAGAD_SIMULATED', 'ROCKET_SIMULATED']).default('BKASH_SIMULATED'));
const outcome = z.preprocess(lower, z.enum(['success', 'failed']).default('success'));

export const milestoneParamsSchema = z.object({ milestoneId: objectId });
export const paymentParamsSchema = z.object({ id: objectId });
export const fundSchema = z.object({ provider, outcome });
export const simulatedFundSchema = fundSchema.extend({ milestoneId: objectId });
