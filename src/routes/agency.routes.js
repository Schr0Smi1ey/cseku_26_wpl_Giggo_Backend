import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Agency, AgencyInvitation } from '../models/Agency.js';
import { User } from '../models/User.js';
import { requireAuth, requireRole, optionalAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { ApiError } from '../utils/ApiError.js';
import { notificationService } from '../services/notification.service.js';
const router = Router();
const sid = (v) => String(v?._id || v);
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) });
const agencyBody = z.object({ name: z.string().trim().min(3).max(120), description: z.string().trim().min(30).max(5000), skills: z.array(z.string().trim().min(1).max(50)).max(20).default([]), country: z.string().trim().max(80).default(''), website: z.union([z.literal(''), z.string().url().max(500).refine((s) => new URL(s).protocol === 'https:')]).default(''), visibility: z.enum(['public', 'private']).default('private') }).strict();
router.param('id', (req, _res, next, value) => { const r = oid.safeParse(value); next(r.success ? undefined : r.error); });
async function list(filter, page) { const [items, total] = await Promise.all([Agency.find(filter).select('name description country skills website owner visibility').populate('owner', 'name avatar').sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), Agency.countDocuments(filter)]); return { items, total, page, pages: Math.ceil(total / 20) }; }
router.get('/', asyncHandler(async (req, res) => {
  const { page } = pagination.parse(req.query);
  const [result] = await Agency.aggregate([
    { $match: { visibility: 'public' } },
    { $lookup: { from: User.collection.name, localField: 'owner', foreignField: '_id', pipeline: [{ $match: { status: 'active' } }, { $project: { name: 1, avatar: 1 } }], as: 'person' } },
    { $unwind: '$person' },
    { $sort: { createdAt: -1, _id: -1 } },
    { $facet: { items: [{ $skip: (page - 1) * 20 }, { $limit: 20 }, { $project: { name: 1, description: 1, country: 1, skills: 1, website: 1, visibility: 1, owner: '$person' } }], count: [{ $count: 'total' }] } },
  ]);
  const total = result.count[0]?.total || 0;
  return ok(res, { items: result.items, total, page, pages: Math.ceil(total / 20) });
}));
router.get('/mine', requireAuth, asyncHandler(async (req, res) => ok(res, await list({ 'members.user': req.user._id }, pagination.parse(req.query).page))));
router.get('/invitations', requireAuth, asyncHandler(async (req, res) => ok(res, { items: await AgencyInvitation.find({ invitedUser: req.user._id }).sort({ createdAt: -1 }).limit(100).populate('agency', 'name') })));
router.post('/', requireAuth, requireRole('freelancer'), validate(agencyBody), asyncHandler(async (req, res) => {
  await Agency.init();
  try { return ok(res, { agency: await Agency.create({ ...req.body, owner: req.user._id, members: [{ user: req.user._id, role: 'owner' }] }) }, 'Agency created', 201); }
  catch (e) { if (e.code === 11000) throw ApiError.conflict('You already own an agency'); throw e; }
}));
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const agency = await Agency.findById(req.params.id).populate('members.user owner', 'name avatar');
  if (agency && !await User.exists({ _id: agency.owner?._id, status: 'active' })) throw ApiError.notFound('Agency not found');
  const member = agency?.members.some((m) => sid(m.user) === sid(req.user));
  if (!agency || (agency.visibility !== 'public' && !member)) throw ApiError.notFound('Agency not found');
  return ok(res, { agency, memberRole: agency.members.find((m) => sid(m.user) === sid(req.user))?.role || null });
}));
router.put('/:id', requireAuth, validate(agencyBody.extend({ revision: z.number().int().min(1) })), asyncHandler(async (req, res) => {
  const { revision, ...body } = req.body;
  const agency = await Agency.findOneAndUpdate({ _id: req.params.id, owner: req.user._id, revision }, { $set: body, $inc: { revision: 1 } }, { new: true });
  if (!agency) throw ApiError.conflict('Agency changed or you are not its owner');
  return ok(res, { agency });
}));
router.post('/:id/invitations', requireAuth, validate(z.object({ user: oid, role: z.enum(['member', 'manager']).default('member') }).strict()), asyncHandler(async (req, res) => {
  await AgencyInvitation.init();
  let invitation;
  await mongoose.connection.transaction(async (session) => {
    const agency = await Agency.findById(req.params.id).session(session);
    const member = agency?.members.find((m) => sid(m.user) === sid(req.user));
    if (!member || !['owner', 'manager'].includes(member.role) || (req.body.role === 'manager' && member.role !== 'owner')) throw ApiError.forbidden('You cannot invite this membership role');
    if (agency.members.some((m) => sid(m.user) === req.body.user)) throw ApiError.conflict('User is already a member');
    if (!await User.exists({ _id: req.body.user, status: 'active', roles: 'freelancer' }).session(session)) throw ApiError.badRequest('An active freelancer is required');
    invitation = await AgencyInvitation.findOneAndUpdate({ agency: agency._id, invitedUser: req.body.user }, { $set: { invitedBy: req.user._id, role: req.body.role, status: 'pending', expiresAt: new Date(Date.now() + 7 * 86400000), respondedAt: null } }, { new: true, upsert: true, session, runValidators: true });
    await Agency.updateOne({ _id: agency._id }, { $inc: { revision: 1 } }, { session });
  });
  await notificationService.publish({ recipient: req.body.user, actor: req.user._id, type: 'agency_invitation', title: 'Agency invitation', actionUrl: '/dashboard/agencies', entityType: 'agency', entityId: invitation.agency, eventKey: `agency-invite:${invitation._id}:${invitation.updatedAt.getTime()}` }).catch(() => null);
  return ok(res, { invitation });
}));
router.post('/invitations/:id/respond', requireAuth, validate(z.object({ decision: z.enum(['accept', 'decline']) }).strict()), asyncHandler(async (req, res) => {
  let result;
  await mongoose.connection.transaction(async (session) => {
    const invitation = await AgencyInvitation.findOne({ _id: req.params.id, invitedUser: req.user._id, status: 'pending' }).session(session);
    if (!invitation || invitation.expiresAt < new Date()) throw ApiError.conflict('Invitation expired or already answered');
    const agency = await Agency.findById(invitation.agency).session(session);
    if (!agency) throw ApiError.notFound('Agency not found');
    if (req.body.decision === 'accept') {
      if (agency.members.length >= 100) throw ApiError.badRequest('Agency member limit reached');
      if (!agency.members.some((m) => sid(m.user) === sid(req.user))) agency.members.push({ user: req.user._id, role: invitation.role });
      agency.revision += 1; await agency.save({ session });
    }
    invitation.status = req.body.decision === 'accept' ? 'accepted' : 'declined'; invitation.respondedAt = new Date();
    await invitation.save({ session }); result = invitation;
  });
  return ok(res, { invitation: result });
}));
router.get('/:id/invitations', requireAuth, asyncHandler(async (req, res) => {
  const agency = await Agency.findById(req.params.id);
  const actor = agency?.members.find(m => sid(m.user) === sid(req.user));
  if (!actor || !['owner', 'manager'].includes(actor.role)) throw ApiError.forbidden('Agency management access required');
  const { page } = pagination.parse(req.query);
  const filter = { agency: agency._id, status: 'pending', expiresAt: mongoose.trusted({ $gt: new Date() }), ...(actor.role === 'manager' ? { role: 'member' } : {}) };
  const [items, total] = await Promise.all([
    AgencyInvitation.find(filter).populate('invitedUser', 'name avatar').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
    AgencyInvitation.countDocuments(filter),
  ]);
  return ok(res, { items, total, page, pages: Math.ceil(total / 20) });
}));
router.post('/:id/invitations/:invitationId/revoke', requireAuth, validate(z.object({ revision: z.number().int().min(1) }).strict()), asyncHandler(async (req, res) => {
  const invitationId = oid.parse(req.params.invitationId);
  let result;
  await mongoose.connection.transaction(async session => {
    const agency = await Agency.findById(req.params.id).session(session);
    const actor = agency?.members.find(m => sid(m.user) === sid(req.user));
    if (!actor || !['owner', 'manager'].includes(actor.role)) throw ApiError.forbidden('Agency management access required');
    if (agency.revision !== req.body.revision) throw ApiError.conflict('Agency changed; refresh before revoking');
    const invitation = await AgencyInvitation.findOne({ _id: invitationId, agency: agency._id, status: 'pending' }).session(session);
    if (!invitation) throw ApiError.conflict('Invitation already answered or revoked');
    if (actor.role !== 'owner' && invitation.role !== 'member') throw ApiError.forbidden('Only the owner can revoke manager invitations');
    invitation.status = 'revoked'; invitation.respondedAt = new Date();
    await invitation.save({ session });
    agency.revision += 1; await agency.save({ session }); result = invitation;
  });
  return ok(res, { invitation: result });
}));
router.post('/:id/members', requireAuth, validate(z.object({ user: oid, action: z.enum(['remove', 'transfer_owner', 'change_role']), role: z.enum(['member', 'manager']).optional(), revision: z.number().int().min(1) }).strict().refine(v => (v.action === 'change_role') === Boolean(v.role), 'Role is required only when changing membership role')), asyncHandler(async (req, res) => {
  let result;
  await mongoose.connection.transaction(async (session) => {
    const agency = await Agency.findById(req.params.id).session(session);
    const actor = agency?.members.find((m) => sid(m.user) === sid(req.user));
    const target = agency?.members.find((m) => sid(m.user) === req.body.user);
    if (!actor || !target || agency.revision !== req.body.revision) throw ApiError.conflict('Agency changed or membership unavailable');
    if (req.body.action === 'transfer_owner') {
      if (actor.role !== 'owner' || target.role === 'owner') throw ApiError.forbidden('Only the owner can transfer ownership to another member');
      if (!await User.exists({ _id: target.user, status: 'active' }).session(session)) throw ApiError.badRequest('New owner must be active');
      actor.role = 'manager'; target.role = 'owner'; agency.owner = target.user;
    } else if (req.body.action === 'change_role') {
      if (actor.role !== 'owner' || target.role === 'owner') throw ApiError.forbidden('Only the owner can change another member role');
      if (target.role === req.body.role) throw ApiError.badRequest('Member already has this role');
      if (req.body.role === 'manager' && !await User.exists({ _id: target.user, status: 'active' }).session(session)) throw ApiError.badRequest('Manager must be active');
      target.role = req.body.role;
    } else {
      if (target.role === 'owner') throw ApiError.badRequest('Transfer ownership before leaving');
      if (sid(target.user) !== sid(req.user) && actor.role !== 'owner' && !(actor.role === 'manager' && target.role === 'member')) throw ApiError.forbidden('You cannot remove this member');
      agency.members = agency.members.filter((m) => sid(m.user) !== req.body.user);
      await AgencyInvitation.updateOne({ agency: agency._id, invitedUser: target.user }, { status: 'revoked' }, { session });
    }
    agency.revision += 1; await agency.save({ session }); result = agency;
  });
  return ok(res, { agency: result });
}));
export default router;
