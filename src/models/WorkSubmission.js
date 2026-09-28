import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SUBMISSION_STATUSES = Object.freeze({
  SUBMITTED: 'submitted',
  REVISION_REQUESTED: 'revision_requested',
  APPROVED: 'approved',
});

const workSubmissionSchema = new Schema(
  {
    milestone: { type: Schema.Types.ObjectId, ref: 'Milestone', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 5000 },
    links: {
      type: [String],
      default: [],
      validate: { validator: (items) => items.length <= 10, message: 'A submission can contain at most 10 links' },
    },
    version: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: Object.values(SUBMISSION_STATUSES),
      default: SUBMISSION_STATUSES.SUBMITTED,
      index: true,
    },
    feedback: { type: String, trim: true, maxlength: 2000, default: '' },
    submittedAt: { type: Date, required: true, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

workSubmissionSchema.index({ milestone: 1, version: 1 }, { unique: true });
workSubmissionSchema.index({ project: 1, createdAt: -1 });

export const WorkSubmission = mongoose.model('WorkSubmission', workSubmissionSchema);
