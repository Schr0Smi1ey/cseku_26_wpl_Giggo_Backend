import mongoose from 'mongoose';

const { Schema } = mongoose;

const progressHistorySchema = new Schema(
  {
    from: { type: Number, min: 0, max: 100, default: null },
    to: { type: Number, required: true, min: 0, max: 100 },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, enum: ['client', 'freelancer', 'system'], required: true },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const projectSchema = new Schema(
  {
    contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, unique: true, index: true },
    offer: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, unique: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    progress: { type: Number, required: true, min: 0, max: 100, default: 0 },
    progressUpdatedAt: { type: Date, default: null },
    progressUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    progressHistory: {
      type: [progressHistorySchema],
      default: [],
      validate: { validator: (items) => items.length <= 100, message: 'A project can retain at most 100 progress events' },
    },
  },
  { timestamps: true, versionKey: false },
);

projectSchema.index({ client: 1, updatedAt: -1 });
projectSchema.index({ freelancer: 1, updatedAt: -1 });

export const Project = mongoose.model('Project', projectSchema);
