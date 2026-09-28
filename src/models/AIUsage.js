import mongoose from 'mongoose';

const aiUsageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    feature: { type: String, enum: ['proposal_draft'], required: true, index: true },
    provider: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true, versionKey: false },
);

aiUsageSchema.index({ user: 1, feature: 1, createdAt: -1 });

export const AIUsage = mongoose.model('AIUsage', aiUsageSchema);
