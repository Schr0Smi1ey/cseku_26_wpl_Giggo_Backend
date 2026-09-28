import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TIMER_STATUSES = Object.freeze({
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
});

const activeTimerSchema = new Schema(
  {
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    description: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
    startedAt: { type: Date, required: true, default: Date.now },
    lastHeartbeatAt: { type: Date, required: true, default: Date.now },
    stoppedAt: { type: Date, default: null },
    status: { type: String, enum: Object.values(TIMER_STATUSES), default: TIMER_STATUSES.RUNNING },
    active: { type: Boolean, required: true, default: true },
    startIdempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 100 },
    entry: { type: Schema.Types.ObjectId, ref: 'TimeEntry', default: null },
  },
  { timestamps: true, versionKey: false },
);

activeTimerSchema.index(
  { freelancer: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
activeTimerSchema.index({ freelancer: 1, startIdempotencyKey: 1 }, { unique: true });
activeTimerSchema.index({ project: 1, createdAt: -1 });

export const ActiveTimer = mongoose.model('ActiveTimer', activeTimerSchema);
