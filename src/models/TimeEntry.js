import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TIME_ENTRY_SOURCES = Object.freeze({
  TIMER: 'timer',
  MANUAL: 'manual',
});

export const TIME_ENTRY_STATUSES = Object.freeze({
  COMPLETED: 'completed',
  DELETED: 'deleted',
});

const previousSchema = new Schema(
  {
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    description: { type: String, required: true },
    status: { type: String, enum: Object.values(TIME_ENTRY_STATUSES), required: true },
  },
  { _id: false },
);

const revisionSchema = new Schema(
  {
    revision: { type: Number, required: true, min: 1 },
    action: { type: String, enum: ['updated', 'deleted'], required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
    previous: { type: previousSchema, required: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const timeEntrySchema = new Schema(
  {
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    timer: { type: Schema.Types.ObjectId, ref: 'ActiveTimer', default: null },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 1, max: 720 },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
    source: { type: String, enum: Object.values(TIME_ENTRY_SOURCES), required: true },
    hourlyRate: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    estimatedAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: { type: String, enum: Object.values(TIME_ENTRY_STATUSES), default: TIME_ENTRY_STATUSES.COMPLETED, index: true },
    revision: { type: Number, required: true, min: 1, default: 1 },
    revisions: {
      type: [revisionSchema],
      default: [],
      validate: { validator: (items) => items.length <= 50, message: 'A time entry can retain at most 50 revisions' },
    },
    idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 120 },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletionReason: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, versionKey: false },
);

timeEntrySchema.index({ freelancer: 1, idempotencyKey: 1 }, { unique: true });
timeEntrySchema.index(
  { timer: 1 },
  { unique: true, partialFilterExpression: { timer: { $type: 'objectId' } } },
);
timeEntrySchema.index({ project: 1, startedAt: -1 });
timeEntrySchema.index({ freelancer: 1, startedAt: 1, endedAt: 1 });

export const TimeEntry = mongoose.model('TimeEntry', timeEntrySchema);
