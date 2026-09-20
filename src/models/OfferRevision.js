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

const offerRevisionSchema = new Schema(
  {
    offer: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, index: true },
    number: { type: Number, required: true, min: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
    description: { type: String, required: true, trim: true, minlength: 20, maxlength: 5000 },
    budget: { type: budgetSchema, required: true },
    estimatedDays: { type: Number, required: true, min: 1, max: 3650 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    terms: { type: String, trim: true, maxlength: 5000, default: '' },
    milestones: {
      type: [milestoneSchema],
      default: [],
      validate: { validator: (items) => items.length <= 10, message: 'An offer can contain at most 10 milestones' },
    },
    publishedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

offerRevisionSchema.index({ offer: 1, number: 1 }, { unique: true });
offerRevisionSchema.index({ offer: 1, publishedAt: -1 });

export const OfferRevision = mongoose.model('OfferRevision', offerRevisionSchema);
