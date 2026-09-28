import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MILESTONE_STATUSES = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  REVISION_REQUESTED: 'revision_requested',
  APPROVED: 'approved',
});

const milestoneSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    sourceMilestoneId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    dueDate: { type: Date, default: null },
    order: { type: Number, required: true, min: 0, max: 99 },
    status: {
      type: String,
      enum: Object.values(MILESTONE_STATUSES),
      default: MILESTONE_STATUSES.PENDING,
      index: true,
    },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

milestoneSchema.index({ project: 1, order: 1 }, { unique: true });
milestoneSchema.index({ contract: 1, status: 1 });

export const Milestone = mongoose.model('Milestone', milestoneSchema);
