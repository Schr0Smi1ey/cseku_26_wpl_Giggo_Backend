import mongoose from 'mongoose';
import { PAYMENT_STATUS, ESCROW_STATUS } from '../config/constants.js';
const { Schema } = mongoose;
const schema = new Schema({
  paymentNumber: { type: String, unique: true, index: true },
  transactionReference: { type: String, unique: true, index: true },
  client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  developerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  job: { type: Schema.Types.ObjectId, ref: 'Job' },
  proposal: { type: Schema.Types.ObjectId, ref: 'Proposal' },
  offer: { type: Schema.Types.ObjectId, ref: 'Offer' },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  contractId: { type: Schema.Types.ObjectId, ref: 'Contract', index: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project' },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  milestone: { type: Schema.Types.ObjectId, ref: 'Milestone', required: true, unique: true },
  milestoneId: { type: Schema.Types.ObjectId, ref: 'Milestone', index: true },
  provider: { type: String, required: true },
  paymentMethod: { type: String, index: true },
  providerPaymentId: { type: String, index: true },
  providerCheckoutSessionId: String,
  amount: { type: Number, min: 0, required: true },
  amountMinor: { type: Number, min: 0, required: true },
  currency: { type: String, required: true, uppercase: true },
  platformFee: { type: Number, min: 0, required: true },
  freelancerAmount: { type: Number, min: 0, required: true },
  status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.CREATED, index: true },
  escrowStatus: { type: String, enum: Object.values(ESCROW_STATUS), default: ESCROW_STATUS.NOT_FUNDED, index: true },
  failureReason: String,
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  paidAt: Date,
  processingAt: Date,
  completedAt: Date,
  processAfter: Date,
  simulationOutcome: { type: String, enum: ['success', 'failed'], select: false },
  refundedAt: Date,
}, { timestamps: true });
schema.index({ client: 1, createdAt: -1 });
schema.index({ freelancer: 1, createdAt: -1 });
export const Payment = mongoose.model('Payment', schema);
