import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    eventKey: { type: String, trim: true, maxlength: 180, default: null },
    type: { type: String, required: true, trim: true, maxlength: 60, index: true },
    category: { type: String, enum: ['messages', 'proposals', 'offers', 'contracts', 'payments', 'disputes', 'verification', 'system'], default: 'system' },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, trim: true, maxlength: 500, default: '' },
    actionUrl: { type: String, trim: true, maxlength: 500, default: '' },
    entityType: { type: String, trim: true, maxlength: 60, default: '' },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ recipient: 1, archivedAt: 1, createdAt: -1 });
notificationSchema.index(
  { recipient: 1, eventKey: 1 },
  { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } },
);

export const Notification = mongoose.model('Notification', notificationSchema);
