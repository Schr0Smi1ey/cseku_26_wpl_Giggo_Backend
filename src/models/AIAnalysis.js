import mongoose from 'mongoose';

const recommendationSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  detail: { type: String, default: '' },
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
}, { _id: false });

const analysisSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  textHash: { type: String, required: true, index: true },
  provider: { type: String, required: true },
  source: { kind: { type: String, enum: ['text', 'cv_file'], required: true }, filename: { type: String, default: '' } },
  result: {
    summary: { type: String, default: '' }, overallScore: { type: Number, min: 0, max: 100 }, atsScore: { type: Number, min: 0, max: 100 },
    detectedSkills: { type: [String], default: [] }, suggestedSkills: { type: [String], default: [] }, experienceYears: { type: Number, default: 0 }, seniority: { type: String, default: 'junior' },
    strengths: { type: [String], default: [] }, weaknesses: { type: [String], default: [] }, recommendations: { type: [recommendationSchema], default: [] },
    missingSections: { type: [String], default: [] }, wordCount: { type: Number, default: 0 }, disclaimer: { type: String, default: '' },
  },
}, { timestamps: true, versionKey: false });

analysisSchema.index({ user: 1, textHash: 1, createdAt: -1 });
export const AIAnalysis = mongoose.model('AIAnalysis', analysisSchema);
