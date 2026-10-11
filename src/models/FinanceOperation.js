import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({ actor: { type: Schema.Types.ObjectId, ref: 'User', required: true }, user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, kind: { type: String, enum: ['withdrawal', 'adjustment', 'refund'], required: true }, idempotencyKey: { type: String, required: true }, amountCents: { type: Number, required: true }, currency: { type: String, required: true }, status: { type: String, enum: ['succeeded', 'failed'], required: true }, outcome: String, reason: { type: String, required: true }, payment: { type: Schema.Types.ObjectId, ref: 'Payment' } }, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ actor: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ user: 1, createdAt: -1 });
export const FinanceOperation = mongoose.model('FinanceOperation', schema);
