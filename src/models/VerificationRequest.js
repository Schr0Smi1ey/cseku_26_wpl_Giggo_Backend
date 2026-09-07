import mongoose from 'mongoose';

const { Schema } = mongoose;

const documentSchema = new Schema(
  {
    filename: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 150 },
    path: { type: String, required: true, select: false },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const verificationRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['identity', 'document'], required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    documents: { type: [documentSchema], default: [] },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

verificationRequestSchema.index({ user: 1, type: 1, status: 1 });
verificationRequestSchema.index({ status: 1, createdAt: 1 });

verificationRequestSchema.set('toJSON', {
  transform: (_doc, ret) => {
    if (Array.isArray(ret.documents)) ret.documents.forEach((document) => delete document.path);
    return ret;
  },
});

export const VerificationRequest = mongoose.model('VerificationRequest', verificationRequestSchema);
