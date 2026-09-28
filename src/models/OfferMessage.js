import mongoose from 'mongoose';

const { Schema } = mongoose;

const offerMessageSchema = new Schema(
  {
    offer: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    senderRole: { type: String, enum: ['client', 'freelancer', 'system'], required: true },
    kind: { type: String, enum: ['message', 'change_request', 'system'], default: 'message' },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    revision: { type: Number, min: 1, default: null },
  },
  { timestamps: true, versionKey: false },
);

offerMessageSchema.index({ offer: 1, createdAt: 1 });

export const OfferMessage = mongoose.model('OfferMessage', offerMessageSchema);
