import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { Proposal } from '../models/Proposal.js';
import { Contract } from '../models/Contract.js';
import { SavedJob } from '../models/SavedJob.js';
import { WalletLedgerEntry } from '../models/WalletLedgerEntry.js';

const router = Router();
router.get('/summary', requireAuth, requireRole('client', 'freelancer'), asyncHandler(async (req, res) => {
  const client = req.user.hasRole('client');
  const owner = client ? { client: req.user._id } : { freelancer: req.user._id };
  const [activeContracts, proposalCount, savedJobs, spending] = await Promise.all([
    Contract.countDocuments({ ...owner, status: 'active' }),
    Proposal.countDocuments({ ...owner, ...(client ? {} : { status: mongoose.trusted({ $in: ['submitted', 'shortlisted'] }) }) }),
    client ? 0 : SavedJob.countDocuments({ user: req.user._id }),
    client ? WalletLedgerEntry.aggregate([
      { $match: { user: req.user._id, $or: [{ type: 'client_payment', direction: 'debit' }, { type: 'refund', direction: 'credit' }] } },
      { $group: { _id: '$currency', amount: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
      { $project: { _id: 0, currency: '$_id', amount: { $round: ['$amount', 2] } } },
      { $sort: { currency: 1 } },
    ]) : [],
  ]);
  return ok(res, { activeContracts, ...(client ? { receivedProposals: proposalCount, spending } : { activeProposals: proposalCount, savedJobs }) });
}));
export default router;
