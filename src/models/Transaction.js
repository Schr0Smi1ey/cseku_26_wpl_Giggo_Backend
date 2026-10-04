import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({ transactionNumber: { type: String, unique: true, index: true }, user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, payment: { type: Schema.Types.ObjectId, ref: 'Payment' }, project: { type: Schema.Types.ObjectId, ref: 'Project' }, contract: { type: Schema.Types.ObjectId, ref: 'Contract' }, milestone: { type: Schema.Types.ObjectId, ref: 'Milestone' }, type: { type: String, required: true, index: true }, direction: { type: String, enum: ['credit', 'debit'], required: true }, amount: { type: Number, min: 0, required: true }, amountMinor: { type: Number, min: 0, required: true }, currency: { type: String, required: true }, balanceBefore: Number, balanceAfter: Number, status: { type: String, enum: ['pending', 'completed', 'failed', 'reversed'], default: 'completed' }, description: String, metadata: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true });
schema.index({ user: 1, createdAt: -1 });
schema.index({ payment: 1, type: 1 }, { unique: true, sparse: true });
export const Transaction = mongoose.model('Transaction', schema);
