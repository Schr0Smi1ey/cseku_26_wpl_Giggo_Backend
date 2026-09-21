import mongoose from 'mongoose';

const categoryDefaults = {
  messages: true,
  proposals: true,
  offers: true,
  contracts: true,
  payments: true,
  disputes: true,
  verification: true,
  system: true,
};

const notificationPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    inApp: { type: Map, of: Boolean, default: () => ({ ...categoryDefaults }) },
  },
  { timestamps: true, versionKey: false },
);

export const NOTIFICATION_CATEGORIES = Object.freeze(Object.keys(categoryDefaults));
export const NotificationPreference = mongoose.model('NotificationPreference', notificationPreferenceSchema);
