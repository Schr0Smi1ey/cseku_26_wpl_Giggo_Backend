import mongoose from 'mongoose';

const { Schema } = mongoose;

const bidSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    type: { type: String, enum: ['fixed', 'hourly'], required: true },
    currency: { type: String, required: true, trim: true, uppercase: true, minlength: 3, maxlength: 3 },
  },
  { _id: false },
);

const milestoneSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    dueDate: { type: Date, default: null },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { _id: true },
);

const proposalSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    coverLetter: { type: String, required: true, trim: true, minlength: 100, maxlength: 5000 },
    bid: { type: bidSchema, required: true },
    estimatedDays: { type: Number, required: true, min: 1, max: 3650 },
    milestones: {
      type: [milestoneSchema],
      default: [],
      validate: { validator: (items) => items.length <= 10, message: 'A proposal can contain at most 10 milestones' },
    },
    aiAssisted: { type: Boolean, default: false },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
    viewedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['submitted', 'shortlisted', 'rejected', 'withdrawn', 'accepted'],
      default: 'submitted',
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
);

proposalSchema.index({ job: 1, freelancer: 1 }, { unique: true });
proposalSchema.index({ freelancer: 1, createdAt: -1 });
proposalSchema.index({ client: 1, status: 1, createdAt: -1 });
proposalSchema.index({ job: 1, status: 1, createdAt: -1 });

export const Proposal = mongoose.model('Proposal', proposalSchema);
