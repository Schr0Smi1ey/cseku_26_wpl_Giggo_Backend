import { z } from 'zod';

const provider = z.enum(['BKASH_SIMULATED', 'NAGAD_SIMULATED', 'ROCKET_SIMULATED']);

export const reloadSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  provider,
  outcome: z.enum(['success', 'failed']).optional().default('success'),
});
