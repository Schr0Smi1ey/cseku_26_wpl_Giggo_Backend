import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '../models/NotificationPreference.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const cursor = objectId.optional();
const conversationCursor = z.string().regex(/^\d+_[a-f\d]{24}$/i, 'Invalid cursor').optional();
const booleanQuery = z.preprocess(
  (value) => value === undefined ? false : value,
  z.union([z.enum(['true', 'false']), z.boolean()]),
).transform((value) => value === true || value === 'true');

export const createConversationSchema = z.object({
  participantIds: z.array(objectId).min(1).max(19),
  title: z.string().trim().max(120).optional().default(''),
}).strict();

export const conversationIdParamsSchema = z.object({ conversationId: objectId }).strict();
export const messageIdParamsSchema = z.object({ messageId: objectId }).strict();
export const participantParamsSchema = z.object({ conversationId: objectId, userId: objectId }).strict();

export const conversationListSchema = z.object({
  cursor: conversationCursor,
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().trim().max(80).optional().default(''),
}).strict();

export const contactsQuerySchema = z.object({ search: z.string().trim().max(80).optional().default('') }).strict();

export const messageListSchema = z.object({
  cursor,
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  search: z.string().trim().max(100).optional().default(''),
  pinned: booleanQuery,
  saved: booleanQuery,
}).strict();

export const createMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().trim().min(8).max(80),
  replyTo: objectId.nullish().transform((value) => value || null),
}).strict();

export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();
export const reactionSchema = z.object({ emoji: z.string().trim().max(8).optional().default('') }).strict();
export const conversationSettingsSchema = z.object({
  muted: z.boolean().optional(),
  archived: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Choose a setting to update');
export const addParticipantSchema = z.object({ userId: objectId }).strict();

export const notificationListSchema = z.object({
  cursor,
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  unreadOnly: booleanQuery,
}).strict();
export const notificationIdParamsSchema = z.object({ id: objectId }).strict();
export const notificationPreferenceSchema = z.object({
  inApp: z.object(Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, z.boolean()]))).strict(),
}).strict();
