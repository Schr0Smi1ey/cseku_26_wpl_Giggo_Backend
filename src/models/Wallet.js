import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true }, availableBalance: { type: Number, min: 0, default: 0 }, pendingBalance: { type: Number, min: 0, default: 0 }, totalEarned: { type: Number, min: 0, default: 0 }, totalWithdrawn: { type: Number, min: 0, default: 0 }, totalRefunded: { type: Number, min: 0, default: 0 }, currency: { type: String, default: 'USD' }, status: { type: String, enum: ['active', 'restricted', 'suspended'], default: 'active' } }, { timestamps: true });
export const Wallet = mongoose.model('Wallet', schema);
