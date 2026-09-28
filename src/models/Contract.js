import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CONTRACT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const budgetSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    type: { type: String, enum: ['fixed', 'hourly'], required: true },
    currency: { type: String, required: true, trim: true, uppercase: true, minlength: 3, maxlength: 3 },
  },
  { _id: false },
);

const milestoneSchema = new Schema(
  {
    sourceMilestoneId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    dueDate: { type: Date, default: null },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { _id: true },
);

const historySchema = new Schema(
  {
    from: { type: String, enum: [...Object.values(CONTRACT_STATUSES), null], default: null },
    to: { type: String, enum: Object.values(CONTRACT_STATUSES), required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, enum: ['client', 'freelancer', 'system'], required: true },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const contractSchema = new Schema(
  {
    offer: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, unique: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    acceptedRevision: { type: Schema.Types.ObjectId, ref: 'OfferRevision', required: true },
    proposal: { type: Schema.Types.ObjectId, ref: 'Proposal', required: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
    description: { type: String, required: true, trim: true, minlength: 20, maxlength: 5000 },
    budget: { type: budgetSchema, required: true },
    estimatedDays: { type: Number, required: true, min: 1, max: 3650 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    terms: { type: String, trim: true, maxlength: 5000, default: '' },
    milestones: {
      type: [milestoneSchema],
      default: [],
      validate: { validator: (items) => items.length <= 10, message: 'A contract can contain at most 10 milestones' },
    },
    status: { type: String, enum: Object.values(CONTRACT_STATUSES), default: CONTRACT_STATUSES.ACTIVE, index: true },
    statusHistory: { type: [historySchema], default: [] },
    activatedAt: { type: Date, required: true, default: Date.now },
    pausedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

contractSchema.index({ client: 1, status: 1, createdAt: -1 });
contractSchema.index({ freelancer: 1, status: 1, createdAt: -1 });

export const Contract = mongoose.model('Contract', contractSchema);
