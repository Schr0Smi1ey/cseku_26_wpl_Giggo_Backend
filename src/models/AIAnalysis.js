import mongoose from 'mongoose';

const recommendationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    detail: { type: String, required: true, trim: true, maxlength: 600 },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  },
  { _id: false },
);

const aiAnalysisSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    textHash: { type: String, required: true, index: true },
    provider: { type: String, required: true, trim: true },
    source: {
      kind: { type: String, enum: ['text', 'cv_file'], required: true },
      filename: { type: String, trim: true, maxlength: 255, default: '' },
    },
    result: {
      summary: { type: String, required: true, maxlength: 600 },
      overallScore: { type: Number, required: true, min: 0, max: 100 },
      atsScore: { type: Number, required: true, min: 0, max: 100 },
      detectedSkills: { type: [String], default: [] },
      suggestedSkills: { type: [String], default: [] },
      experienceYears: { type: Number, min: 0, max: 80, default: 0 },
      seniority: { type: String, enum: ['junior', 'mid', 'senior'], default: 'junior' },
      strengths: { type: [String], default: [] },
      weaknesses: { type: [String], default: [] },
      recommendations: { type: [recommendationSchema], default: [] },
      missingSections: { type: [String], default: [] },
      wordCount: { type: Number, min: 0, default: 0 },
      disclaimer: { type: String, required: true, maxlength: 500 },
    },
  },
  { timestamps: true, versionKey: false },
);

aiAnalysisSchema.index({ user: 1, textHash: 1, createdAt: -1 });
aiAnalysisSchema.index({ user: 1, createdAt: -1 });

export const AIAnalysis = mongoose.model('AIAnalysis', aiAnalysisSchema);
