import { FreelancerProfile } from '../models/FreelancerProfile.js';
import { User } from '../models/User.js';
import { VerificationRequest } from '../models/VerificationRequest.js';

export function deriveBadges(user, approvedTypes = []) {
  const approved = new Set(approvedTypes);
  const badges = [];
  if (user?.emailVerified) badges.push('email_verified');
  if (user?.phoneVerified) badges.push('phone_verified');
  if (approved.has('identity')) badges.push('identity_verified');
  if (approved.has('document')) badges.push('document_verified');

  let verificationState = 'UNVERIFIED';
  if (approved.has('identity')) {
    verificationState = 'VERIFIED';
    badges.push('verified');
  } else if (approved.has('document')) {
    verificationState = 'DOCUMENT_VERIFIED';
  }
  return { badges, verificationState };
}

export async function approvedTypesFor(userId) {
  return VerificationRequest.find({ user: userId, status: 'approved' }).distinct('type');
}

export async function syncUserBadges(userId) {
  const [user, approvedTypes] = await Promise.all([User.findById(userId), approvedTypesFor(userId)]);
  const derived = deriveBadges(user, approvedTypes);
  await FreelancerProfile.updateOne(
    { user: userId },
    { $set: { badges: derived.badges, verificationState: derived.verificationState } },
  );
  return derived;
}
