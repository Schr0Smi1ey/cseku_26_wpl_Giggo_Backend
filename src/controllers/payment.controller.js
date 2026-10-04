import { emitPayment, paymentService, publicPayment } from '../services/payment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

const queued = (res, payment) => ok(res, { payment: publicPayment(payment) }, 'Payment queued', 202);

export const paymentController = {
  fund: asyncHandler(async (req, res) => {
    const payment = await paymentService.fundMilestone(req.user, req.params.milestoneId, req.get('Idempotency-Key'), req.body.provider, req.body.outcome);
    emitPayment(payment, 'payment:created');
    return queued(res, payment);
  }),
  simulate: asyncHandler(async (req, res) => {
    const payment = await paymentService.simulateFundMilestone(req.user, req.body.milestoneId, req.body.outcome, req.get('Idempotency-Key'), req.body.provider);
    emitPayment(payment, 'payment:created');
    return queued(res, payment);
  }),
  list: asyncHandler(async (req, res) => ok(res, { payments: await paymentService.list(req.user) })),
  get: asyncHandler(async (req, res) => ok(res, { payment: await paymentService.getOne(req.user, req.params.id) })),
  release: asyncHandler(async (req, res) => {
    const tx = await paymentService.release(req.user, req.params.milestoneId);
    return ok(res, { transaction: { _id: tx._id, transactionNumber: tx.transactionNumber, status: tx.status } }, 'Funds released');
  }),
  wallet: asyncHandler(async (req, res) => ok(res, { wallet: await paymentService.getWallet(req.user) })),
  transactions: asyncHandler(async (req, res) => ok(res, { transactions: await paymentService.transactions(req.user) })),
};
