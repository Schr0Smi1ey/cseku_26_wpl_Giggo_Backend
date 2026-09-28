import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SIMULATED_PROVIDER = Object.freeze({
  BKASH: 'BKASH_SIMULATED',
  NAGAD: 'NAGAD_SIMULATED',
  ROCKET: 'ROCKET_SIMULATED',
});

export const SIMULATED_PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
});

const schema = new Schema(
  {
    transactionNumber: { type: String, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    card: { type: Schema.Types.ObjectId, ref: 'VirtualCard', index: true },
    amount: { type: Number, min: 0, required: true },
    currency: { type: String, uppercase: true, default: 'BDT' },
    provider: { type: String, enum: Object.values(SIMULATED_PROVIDER), required: true },
    providerTransactionId: { type: String, unique: true, index: true },
    type: { type: String, enum: ['card_reload', 'client_funding', 'developer_earning', 'refund'], required: true },
    status: { type: String, enum: Object.values(SIMULATED_PAYMENT_STATUS), default: SIMULATED_PAYMENT_STATUS.PENDING, index: true },
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    completedAt: Date,
  },
  { timestamps: true },
);

schema.index({ user: 1, createdAt: -1 });

export const PaymentTransaction = mongoose.model('PaymentTransaction', schema);
