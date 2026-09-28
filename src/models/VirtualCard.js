import mongoose from 'mongoose';

const { Schema } = mongoose;

export const VIRTUAL_CARD_STATUS = Object.freeze({
  INACTIVE: 'inactive',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BLOCKED: 'blocked',
  CANCELLED: 'cancelled',
});

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    cardType: { type: String, enum: ['client', 'developer'], required: true, index: true },
    network: { type: String, default: 'Giggo Signature Network' },
    maskedCardNumber: { type: String, required: true },
    cardNumberHash: { type: String, required: true, unique: true },
    expiryMonth: { type: Number, required: true, min: 1, max: 12 },
    expiryYear: { type: Number, required: true },
    status: { type: String, enum: Object.values(VIRTUAL_CARD_STATUS), default: VIRTUAL_CARD_STATUS.INACTIVE, index: true },
    balance: { type: Number, min: 0, default: 0 },
    currency: { type: String, uppercase: true, default: 'BDT' },
    activationMinimum: { type: Number, min: 0, default: 500 },
    activatedAt: Date,
    frozenAt: Date,
  },
  { timestamps: true },
);

schema.index({ cardType: 1, status: 1, createdAt: -1 });
schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.cardNumberHash;
    delete ret.__v;
    return ret;
  },
});

export const VirtualCard = mongoose.model('VirtualCard', schema);
