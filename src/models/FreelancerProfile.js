import mongoose from 'mongoose';

const { Schema } = mongoose;

const languageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    proficiency: { type: String, enum: ['basic', 'conversational', 'fluent', 'native'], required: true },
  },
  { _id: false },
);

const educationSchema = new Schema(
  {
    school: { type: String, required: true, trim: true, maxlength: 150 },
    degree: { type: String, trim: true, maxlength: 150, default: '' },
    field: { type: String, trim: true, maxlength: 150, default: '' },
    startYear: { type: Number, min: 1950, max: 2100 },
    endYear: { type: Number, min: 1950, max: 2100 },
  },
  { _id: true },
);

const experienceSchema = new Schema(
  {
    company: { type: String, required: true, trim: true, maxlength: 150 },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    location: { type: String, trim: true, maxlength: 150, default: '' },
    startDate: { type: Date },
    endDate: { type: Date },
    current: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 3000, default: '' },
  },
  { _id: true },
);

const certificationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    issuer: { type: String, trim: true, maxlength: 150, default: '' },
    year: { type: Number, min: 1950, max: 2100 },
    url: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: true },
);

const portfolioSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    url: { type: String, trim: true, maxlength: 500, default: '' },
    image: { type: String, trim: true, maxlength: 500, default: '' },
    tags: { type: [String], default: [] },
  },
  { _id: true },
);

const freelancerProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    overview: { type: String, trim: true, maxlength: 5000, default: '' },
    category: { type: String, trim: true, maxlength: 80, default: '' },
    hourlyRate: { type: Number, min: 0, max: 100000, default: 0 },
    availability: { type: String, enum: ['full_time', 'part_time', 'not_available'], default: 'not_available' },
    skills: { type: [String], default: [], index: true },
    languages: { type: [languageSchema], default: [] },
    location: {
      country: { type: String, trim: true, maxlength: 80, default: '' },
      city: { type: String, trim: true, maxlength: 80, default: '' },
      timezone: { type: String, trim: true, maxlength: 60, default: '' },
    },
    links: {
      website: { type: String, trim: true, maxlength: 500, default: '' },
      linkedin: { type: String, trim: true, maxlength: 500, default: '' },
      github: { type: String, trim: true, maxlength: 500, default: '' },
    },
    education: { type: [educationSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    portfolio: { type: [portfolioSchema], default: [] },
    visibility: { type: String, enum: ['public', 'private'], default: 'private', index: true },
    completeness: { type: Number, min: 0, max: 100, default: 0 },
    onboardingCompleted: { type: Boolean, default: false },
    // This public cache is written only by the human-review verification service.
    verificationState: {
      type: String,
      enum: ['UNVERIFIED', 'DOCUMENT_VERIFIED', 'VERIFIED'],
      default: 'UNVERIFIED',
      index: true,
    },
    badges: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false },
);

freelancerProfileSchema.index({ title: 'text', overview: 'text', skills: 'text' });

freelancerProfileSchema.methods.computeCompleteness = function computeCompleteness() {
  const checks = [
    [Boolean(this.title), 12],
    [(this.overview || '').length >= 50, 15],
    [Boolean(this.category), 8],
    [this.hourlyRate > 0, 8],
    [this.availability !== 'not_available', 5],
    [(this.skills || []).length >= 3, 15],
    [(this.languages || []).length >= 1, 5],
    [Boolean(this.location?.country), 5],
    [(this.education || []).length >= 1, 7],
    [(this.experience || []).length >= 1, 10],
    [(this.portfolio || []).length >= 1, 10],
  ];
  return checks.reduce((score, [passes, weight]) => score + (passes ? weight : 0), 0);
};

freelancerProfileSchema.pre('save', function recalculateCompleteness(next) {
  this.completeness = this.computeCompleteness();
  next();
});

export const FreelancerProfile = mongoose.model('FreelancerProfile', freelancerProfileSchema);
