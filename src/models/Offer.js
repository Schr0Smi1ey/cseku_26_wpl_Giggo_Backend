import mongoose from 'mongoose';

const { Schema } = mongoose;

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
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    dueDate: { type: Date, default: null },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { _id: true },
);

const offerSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    proposal: { type: Schema.Types.ObjectId, ref: 'Proposal', required: true },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
    description: { type: String, required: true, trim: true, minlength: 20, maxlength: 5000 },
    budget: { type: budgetSchema, required: true },
    estimatedDays: { type: Number, required: true, min: 1, max: 3650 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    terms: { type: String, trim: true, maxlength: 5000, default: '' },
    milestones: {
      type: [milestoneSchema],
      default: [],
      validate: { validator: (items) => items.length <= 10, message: 'An offer can contain at most 10 milestones' },
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'changes_requested', 'revising', 'accepted', 'rejected', 'withdrawn'],
      default: 'draft',
      index: true,
    },
    active: { type: Boolean, default: true },
    revision: { type: Number, min: 1, default: 1 },
    currentRevision: { type: Schema.Types.ObjectId, ref: 'OfferRevision', default: null },
    acceptedRevision: { type: Schema.Types.ObjectId, ref: 'OfferRevision', default: null },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
    changeRequest: { type: String, trim: true, maxlength: 1000, default: '' },
    sentAt: { type: Date, default: null },
    revisedAt: { type: Date, default: null },
    changesRequestedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

offerSchema.index({ proposal: 1, createdAt: -1 });
offerSchema.index(
  { proposal: 1 },
  { name: 'active_offer_per_proposal', unique: true, partialFilterExpression: { active: true } },
);
offerSchema.index({ client: 1, status: 1, createdAt: -1 });
offerSchema.index({ freelancer: 1, status: 1, createdAt: -1 });

export const Offer = mongoose.model('Offer', offerSchema);
