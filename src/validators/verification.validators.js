import { z } from 'zod';

const requestId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid verification request id');
const note = z.string().trim().max(1000);

const requestSchema = z.object({ type: z.enum(['identity', 'document']), note: note.optional() }).strict();
const queueSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  type: z.enum(['identity', 'document']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();
const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']), reviewNote: note.optional() }).strict();
const phoneSchema = z.object({ phone: z.string().trim().min(7).max(20).regex(/^[+]?\d[\d\s()-]{5,18}\d$/).optional() }).strict();
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    req[source] = result.data;
    return next();
  };
}

export const validateVerificationRequest = validate(requestSchema);
export const validateVerificationQueue = validate(queueSchema, 'query');
export const validateVerificationDecision = validate(decisionSchema);
export const validatePhone = validate(phoneSchema);
export const validatePhoneCode = validate(codeSchema);
export const validateRequestId = validate(z.object({ id: requestId }).strict(), 'params');
export const validateDocumentIndex = validate(z.object({ id: requestId, index: z.coerce.number().int().min(0).max(2) }).strict(), 'params');
