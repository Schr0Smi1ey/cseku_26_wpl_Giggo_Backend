import mongoose from 'mongoose';

const { Schema } = mongoose;

const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: null },
    lastReadMessage: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    muted: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group', 'offer'], default: 'direct', index: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    participantIds: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    participants: { type: [participantSchema], required: true },
    directKey: { type: String, trim: true, default: null },
    contextType: { type: String, enum: ['offer'], default: null },
    contextId: { type: Schema.Types.ObjectId, default: null },
    lastMessage: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    lastMessageAt: { type: Date, default: null, index: true },
    activityAt: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

conversationSchema.index({ participantIds: 1, activityAt: -1, _id: -1 });
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } },
);
conversationSchema.index(
  { contextType: 1, contextId: 1 },
  { unique: true, partialFilterExpression: { contextType: { $type: 'string' }, contextId: { $type: 'objectId' } } },
);

export const Conversation = mongoose.model('Conversation', conversationSchema);
