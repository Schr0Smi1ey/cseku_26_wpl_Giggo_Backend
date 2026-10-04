import mongoose from 'mongoose';
import { SIMULATED_PAYMENT_STATUS, SIMULATED_PROVIDER } from '../config/constants.js';
const { Schema } = mongoose;
const schema = new Schema({
  transactionNumber: { type: String, unique: true, index: true },
  transactionReference: { type: String, unique: true, sparse: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  developerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  contractId: { type: Schema.Types.ObjectId, ref: 'Contract', index: true },
  milestoneId: { type: Schema.Types.ObjectId, ref: 'Milestone', index: true },
  card: { type: Schema.Types.ObjectId, ref: 'VirtualCard', index: true },
  wallet: { type: Schema.Types.ObjectId, ref: 'Wallet' },
  amount: { type: Number, min: 0, required: true },
  amountMinor: { type: Number, min: 0 },
  currency: { type: String, uppercase: true, default: 'BDT' },
  paymentMethod: { type: String, index: true },
  provider: { type: String, enum: Object.values(SIMULATED_PROVIDER), required: true },
  providerTransactionId: { type: String, unique: true, sparse: true, index: true },
  type: { type: String, enum: ['card_reload', 'client_payment', 'refund'], required: true },
  status: { type: String, enum: Object.values(SIMULATED_PAYMENT_STATUS), default: SIMULATED_PAYMENT_STATUS.PENDING, index: true },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  completedAt: Date,
}, { timestamps: true });
schema.index({ user: 1, createdAt: -1 });
export const PaymentTransaction = mongoose.model('PaymentTransaction', schema);
