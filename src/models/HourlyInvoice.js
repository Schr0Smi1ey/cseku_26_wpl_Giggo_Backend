import mongoose from 'mongoose';

const { Schema } = mongoose;
const lineSchema = new Schema({
  entry: { type: Schema.Types.ObjectId, ref: 'TimeEntry', required: true },
  revision: { type: Number, required: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, required: true },
  description: { type: String, required: true },
  durationMinutes: { type: Number, required: true },
  hourlyRateCents: { type: Number, required: true },
  amountCents: { type: Number, required: true },
}, { _id: false });
const schema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true },
  client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  currency: { type: String, required: true },
  totalMinutes: { type: Number, required: true },
  totalCents: { type: Number, required: true },
  lines: { type: [lineSchema], required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ project: 1, from: 1, to: 1 }, { unique: true });
schema.index({ 'lines.entry': 1 }, { unique: true });
export const HourlyInvoice = mongoose.model('HourlyInvoice', schema);
