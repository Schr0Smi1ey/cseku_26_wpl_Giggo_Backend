import mongoose from 'mongoose';

const budgetSchema = new mongoose.Schema({ type: { type: String, enum: ['fixed', 'hourly'], default: 'fixed' }, min: { type: Number, min: 0, default: 0 }, max: { type: Number, min: 0, default: 0 }, currency: { type: String, default: 'USD', maxlength: 3 } }, { _id: false });
const jobSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, title: { type: String, required: true, trim: true, minlength: 3, maxlength: 150 },
  description: { type: String, required: true, trim: true, minlength: 20, maxlength: 10000 }, category: { type: String, required: true, trim: true, maxlength: 80, index: true }, skills: { type: [String], default: [] },
  budget: { type: budgetSchema, default: () => ({}) }, experienceLevel: { type: String, enum: ['entry', 'intermediate', 'expert'], default: 'intermediate' }, duration: { type: String, enum: ['short', 'medium', 'long'], default: 'medium' },
  status: { type: String, enum: ['draft', 'open', 'closed', 'filled'], default: 'open', index: true }, savedCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true, versionKey: false });
jobSchema.index({ title: 'text', description: 'text', skills: 'text' });
jobSchema.index({ status: 1, createdAt: -1 });
export const Job = mongoose.model('Job', jobSchema);
