import mongoose from 'mongoose';
import { FINANCE, VIRTUAL_CARD_STATUS } from '../config/constants.js';
const { Schema } = mongoose;
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  cardType: { type: String, default: FINANCE.CARD_TYPE },
  network: { type: String, default: FINANCE.CARD_NETWORK },
  maskedCardNumber: { type: String, required: true },
  cardNumberHash: { type: String, required: true, unique: true },
  expiryMonth: { type: Number, required: true, min: 1, max: 12 },
  expiryYear: { type: Number, required: true },
  status: { type: String, enum: Object.values(VIRTUAL_CARD_STATUS), default: VIRTUAL_CARD_STATUS.INACTIVE, index: true },
  balance: { type: Number, min: 0, default: 0 },
  heldBalance: { type: Number, min: 0, default: 0 },
  currency: { type: String, uppercase: true, default: FINANCE.CURRENCY },
  activationMinimum: { type: Number, min: 0, required: true, default: FINANCE.ACTIVATION_MINIMUM },
  activatedAt: Date,
  frozenAt: Date,
}, { timestamps: true });
schema.index({ status: 1, createdAt: -1 });
schema.set('toJSON', { virtuals: true, transform: (_doc, ret) => { delete ret.cardNumberHash; delete ret.__v; return ret; } });
export const VirtualCard = mongoose.model('VirtualCard', schema);
