import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({
  contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  serviceOrder: { type: Schema.Types.ObjectId, ref: 'ServiceOrder' },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  categories: { communication: { type: Number, min: 1, max: 5, required: true }, quality: { type: Number, min: 1, max: 5, required: true }, reliability: { type: Number, min: 1, max: 5, required: true } },
  title: { type: String, required: true, maxlength: 120 },
  comment: { type: String, required: true, maxlength: 2000 },
  reply: { text: { type: String, maxlength: 1000 }, at: Date },
  hiddenAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
schema.index({ contract: 1, author: 1 }, { unique: true, partialFilterExpression: { contract: { $type: 'objectId' } } });
schema.index({ serviceOrder: 1, author: 1 }, { unique: true, partialFilterExpression: { serviceOrder: { $type: 'objectId' } } });
schema.index({ subject: 1, hiddenAt: 1, createdAt: -1 });
export const Review = mongoose.model('Review', schema);
