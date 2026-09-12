import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { AIAnalysis } from '../models/AIAnalysis.js';
import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/index.js';

const SKILLS = ['javascript', 'typescript', 'python', 'java', 'react', 'vue', 'angular', 'node.js', 'express', 'mongodb', 'postgresql', 'mysql', 'aws', 'docker', 'git', 'figma', 'tailwind', 'html', 'css', 'excel', 'seo'];
const DISCLAIMER = 'This analysis is advisory only. It assesses presentation, not identity, qualifications, or the truth of any claim.';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function analyze(text, profile) {
  const lower = text.toLowerCase(); const words = text.trim().split(/\s+/).filter(Boolean).length;
  const detectedSkills = SKILLS.filter((skill) => lower.includes(skill));
  const years = Math.min(40, Math.max(0, ...[...text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)/gi)].map((match) => Number(match[1])), 0));
  const sections = { summary: /summary|objective|profile/i, experience: /experience|employment|work history/i, education: /education|university|degree/i, skills: /skills|technologies/i, contact: /@|linkedin|github|phone/i };
  const missingSections = Object.entries(sections).filter(([, re]) => !re.test(text)).map(([name]) => name);
  const hasMetrics = /\d+%|\$\d|\d+\s*(users|clients|projects)/i.test(text);
  const overallScore = Math.min(100, Math.round((5 - missingSections.length) * 9 + Math.min(30, detectedSkills.length * 3) + Math.min(25, words / 10)));
  const atsScore = Math.min(100, Math.round((missingSections.includes('contact') ? 0 : 25) + (missingSections.includes('skills') ? 0 : 25) + Math.min(25, detectedSkills.length * 4) + (hasMetrics ? 25 : 10)));
  const existing = new Set((profile?.skills || []).map((skill) => skill.toLowerCase()));
  const recommendations = [];
  if (missingSections.includes('skills')) recommendations.push({ title: 'Add a skills section', detail: 'List relevant tools and technologies for stronger marketplace and ATS matching.', priority: 'high' });
  if (!hasMetrics) recommendations.push({ title: 'Quantify outcomes', detail: 'Use measurable results to show the impact of your work.', priority: 'high' });
  if (missingSections.includes('summary')) recommendations.push({ title: 'Add a concise summary', detail: 'Open with your role, specialty, and strongest evidence.', priority: 'medium' });
  return { summary: `Detected ${detectedSkills.length} relevant skill(s) across ${words} words.`, overallScore, atsScore, detectedSkills, suggestedSkills: detectedSkills.filter((skill) => !existing.has(skill)).slice(0, 15), experienceYears: years, seniority: years >= 5 ? 'senior' : years >= 2 ? 'mid' : 'junior', strengths: [detectedSkills.length >= 5 ? 'Good breadth of recognizable skills.' : 'CV content is readable and ready to improve.', hasMetrics ? 'Includes measurable achievements.' : ''].filter(Boolean), weaknesses: missingSections.map((section) => `Missing or unclear ${section} section.`), recommendations, missingSections, wordCount: words, disclaimer: DISCLAIMER };
}

async function cvText(userId) {
  const profile = await FreelancerProfile.findOne({ user: userId });
  if (!profile?.cv?.storageKey) throw ApiError.badRequest('Upload a CV or paste CV text before analysis');
  if (profile.cv.mimeType !== 'text/plain') throw ApiError.badRequest('Paste text for PDF and Word CV analysis; their text extraction is not configured on this server');
  return { text: (await fs.readFile(profile.cv.storageKey, 'utf8')).slice(0, 100000), profile, source: { kind: 'cv_file', filename: profile.cv.filename } };
}

export const aiService = {
  async analyzeCv(user, { text, force }) {
    let profile = await FreelancerProfile.findOne({ user: user._id }); let source = { kind: 'text', filename: '' }; let input = text;
    if (!input) ({ text: input, profile, source } = await cvText(user._id));
    if (!input?.trim() || input.trim().length < 20) throw ApiError.badRequest('CV text must contain at least 20 characters');
    const textHash = hash(input);
    if (!force) { const cached = await AIAnalysis.findOne({ user: user._id, textHash }).sort({ createdAt: -1 }); if (cached) return cached; }
    return AIAnalysis.create({ user: user._id, textHash, provider: config.ai.provider, source, result: analyze(input, profile) });
  },
  latest: (user) => AIAnalysis.findOne({ user: user._id }).sort({ createdAt: -1 }),
  async list(user, { page = 1, limit = 20 }) { const [items, total] = await Promise.all([AIAnalysis.find({ user: user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), AIAnalysis.countDocuments({ user: user._id })]); return { items, total, page, limit }; },
  async get(user, id) { const analysis = await AIAnalysis.findOne({ _id: id, user: user._id }); if (!analysis) throw ApiError.notFound('Analysis not found'); return analysis; },
  async remove(user, id) { const analysis = await AIAnalysis.findOneAndDelete({ _id: id, user: user._id }); if (!analysis) throw ApiError.notFound('Analysis not found'); return { deleted: true }; },
  async applySkills(user, id) { const analysis = await this.get(user, id); const profile = await FreelancerProfile.findOne({ user: user._id }); if (!profile) throw ApiError.badRequest('Create a freelancer profile first'); const existing = new Set(profile.skills.map((skill) => skill.toLowerCase())); const added = analysis.result.suggestedSkills.filter((skill) => !existing.has(skill.toLowerCase())).slice(0, Math.max(0, 30 - profile.skills.length)); profile.skills.push(...added); await profile.save(); return { profile, added }; },
};
