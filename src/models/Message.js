import mongoose from 'mongoose';

const { Schema } = mongoose;

const reactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true, maxlength: 8 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    clientMessageId: { type: String, trim: true, maxlength: 80, default: null },
    kind: { type: String, enum: ['text', 'system'], default: 'text' },
    body: { type: String, trim: true, maxlength: 4000, default: '' },
    replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    reactions: { type: [reactionSchema], default: [] },
    pinnedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false },
);

messageSchema.index({ conversation: 1, _id: -1 });
messageSchema.index(
  { conversation: 1, sender: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);
messageSchema.index(
  { conversation: 1, 'metadata.legacyOfferMessageId': 1 },
  { unique: true, partialFilterExpression: { 'metadata.legacyOfferMessageId': { $type: 'string' } } },
);

export const Message = mongoose.model('Message', messageSchema);
