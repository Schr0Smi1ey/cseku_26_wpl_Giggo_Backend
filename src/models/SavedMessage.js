import mongoose from 'mongoose';

const savedMessageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
  },
  { timestamps: true, versionKey: false },
);

savedMessageSchema.index({ user: 1, message: 1 }, { unique: true });

export const SavedMessage = mongoose.model('SavedMessage', savedMessageSchema);
