import mongoose from 'mongoose';

const deletedIdentitySchema = new mongoose.Schema(
  {
    supabaseUserId: { type: String, required: true, unique: true, trim: true, maxlength: 128 },
    deletedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false },
);

export const DeletedIdentity = mongoose.model('DeletedIdentity', deletedIdentitySchema);
