import { z } from 'zod';
import { ROLES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

const text = (max) => z.string().trim().max(max);
const optionalUrl = z.string().trim().url().max(500).optional().or(z.literal(''));
const year = z.coerce.number().int().min(1950).max(2100);
const availability = z.enum(['full_time', 'part_time', 'not_available']);
const proficiency = z.enum(['basic', 'conversational', 'fluent', 'native']);

const language = z.object({ name: text(60).min(1), proficiency }).strict();
const education = z.object({
  school: text(150).min(1), degree: text(150).optional().default(''), field: text(150).optional().default(''),
  startYear: year.optional(), endYear: year.optional(),
}).strict();
const experience = z.object({
  company: text(150).min(1), title: text(150).min(1), location: text(150).optional().default(''),
  startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional(), current: z.boolean().optional().default(false),
  description: text(3000).optional().default(''),
}).strict();
const certification = z.object({
  name: text(200).min(1), issuer: text(150).optional().default(''), year: year.optional(), url: optionalUrl,
}).strict();
const portfolio = z.object({
  title: text(200).min(1), description: text(2000).optional().default(''), url: optionalUrl,
  image: optionalUrl, tags: z.array(text(40).min(1)).max(20).optional().default([]),
}).strict();

const freelancerFields = {
  title: text(120), overview: text(5000), category: text(80), hourlyRate: z.coerce.number().min(0).max(100000),
  availability, skills: z.array(text(50).min(1)).max(30), languages: z.array(language).max(15),
  location: z.object({ country: text(80), city: text(80), timezone: text(60) }).strict(),
  links: z.object({ website: optionalUrl, linkedin: optionalUrl, github: optionalUrl }).strict(),
  education: z.array(education).max(20), experience: z.array(experience).max(30),
  certifications: z.array(certification).max(30), portfolio: z.array(portfolio).max(30),
  visibility: z.enum(['public', 'private']),
};

const clientFields = {
  companyName: text(150), companyDescription: text(5000), industry: text(100), website: optionalUrl,
  teamSize: z.enum(['1-10', '11-50', '51-200', '201+']),
  location: z.object({ country: text(80), city: text(80) }).strict(),
};

const freelancerPatchSchema = z.object(freelancerFields).partial().strict();
const clientPatchSchema = z.object(clientFields).partial().strict();
const freelancerOnboardingSchema = z.object({
  title: text(120).min(3), overview: text(5000).min(50), category: text(80).min(1),
  hourlyRate: z.coerce.number().min(0).max(100000), availability,
  skills: z.array(text(50).min(1)).min(3).max(30), languages: z.array(language).min(1).max(15),
  location: z.object({ country: text(80).min(1), city: text(80).optional().default(''), timezone: text(60).optional().default('') }).strict(),
  links: z.object({ website: optionalUrl, linkedin: optionalUrl, github: optionalUrl }).strict().optional(),
  visibility: z.enum(['public', 'private']).optional(),
}).strict();
const clientOnboardingSchema = z.object({
  companyName: text(150).min(2), companyDescription: text(5000).min(50), industry: text(100).min(2),
  website: optionalUrl, teamSize: z.enum(['1-10', '11-50', '51-200', '201+']),
  location: z.object({ country: text(80).min(1), city: text(80).optional().default('') }).strict(),
}).strict();

export const validateProfile = (mode) => (req, _res, next) => {
  const schemas = req.user?.role === ROLES.FREELANCER
    ? { patch: freelancerPatchSchema, onboarding: freelancerOnboardingSchema }
    : req.user?.role === ROLES.CLIENT
      ? { patch: clientPatchSchema, onboarding: clientOnboardingSchema }
      : null;
  if (!schemas) return next(ApiError.forbidden('Profiles are available only to freelancers and clients'));

  const result = schemas[mode].safeParse(req.body);
  if (!result.success) return next(result.error);
  req.body = result.data;
  return next();
};

const talentQuerySchema = z.object({
  search: text(120).optional(), category: text(80).optional(), availability: availability.optional(),
  sort: z.enum(['recent', 'rate_asc', 'rate_desc']).optional(), page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export const validateTalentQuery = (req, _res, next) => {
  const result = talentQuerySchema.safeParse(req.query);
  if (!result.success) return next(result.error);
  req.query = result.data;
  return next();
};
