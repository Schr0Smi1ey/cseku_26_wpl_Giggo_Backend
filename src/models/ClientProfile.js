import mongoose from 'mongoose';

const { Schema } = mongoose;

const clientProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    companyName: { type: String, trim: true, maxlength: 150, default: '' },
    companyDescription: { type: String, trim: true, maxlength: 5000, default: '' },
    industry: { type: String, trim: true, maxlength: 100, default: '' },
    website: { type: String, trim: true, maxlength: 500, default: '' },
    teamSize: { type: String, enum: ['1-10', '11-50', '51-200', '201+'], default: '1-10' },
    location: {
      country: { type: String, trim: true, maxlength: 80, default: '' },
      city: { type: String, trim: true, maxlength: 80, default: '' },
    },
    completeness: { type: Number, min: 0, max: 100, default: 0 },
    onboardingCompleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

clientProfileSchema.methods.computeCompleteness = function computeCompleteness() {
  const checks = [
    [Boolean(this.companyName), 30],
    [(this.companyDescription || '').length >= 50, 30],
    [Boolean(this.industry), 15],
    [Boolean(this.location?.country), 15],
    [Boolean(this.website), 10],
  ];
  return checks.reduce((score, [passes, weight]) => score + (passes ? weight : 0), 0);
};

clientProfileSchema.pre('save', function recalculateCompleteness(next) {
  this.completeness = this.computeCompleteness();
  next();
});

export const ClientProfile = mongoose.model('ClientProfile', clientProfileSchema);
