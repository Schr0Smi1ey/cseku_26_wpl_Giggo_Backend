import { z } from 'zod';

const provider = z.enum(['BKASH_SIMULATED', 'NAGAD_SIMULATED', 'ROCKET_SIMULATED']);

export const reload = z.object({
  amount: z.coerce.number().positive().max(10000000),
  provider,
  outcome: z.enum(['success', 'failed']).optional().default('success'),
});
