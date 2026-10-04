import mongoose from 'mongoose';
import { LEDGER_ENTRY_TYPE } from '../config/constants.js';
const { Schema } = mongoose;
const schema = new Schema({
  entryNumber: { type: String, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  card: { type: Schema.Types.ObjectId, ref: 'VirtualCard', index: true },
  type: { type: String, enum: Object.values(LEDGER_ENTRY_TYPE), required: true, index: true },
  direction: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, min: 0, required: true },
  currency: { type: String, uppercase: true, default: 'BDT' },
  referenceType: { type: String, default: '' },
  referenceId: { type: Schema.Types.ObjectId },
  balanceAfter: { type: Number, min: 0, required: true },
  description: { type: String, maxlength: 300, default: '' },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
schema.index({ user: 1, createdAt: -1 });
schema.index({ card: 1, createdAt: -1 });
schema.index({ referenceId: 1 });
export const WalletLedgerEntry = mongoose.model('WalletLedgerEntry', schema);
