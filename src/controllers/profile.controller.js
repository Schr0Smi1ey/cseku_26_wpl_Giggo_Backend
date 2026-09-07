import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { profileService } from '../services/profile.service.js';

function profileData({ profile, type }) {
  return { profile: { ...profile.toJSON(), type } };
}

export const profileController = {
  getMine: asyncHandler(async (req, res) => ok(res, profileData(await profileService.getMine(req.user)))),
  updateMine: asyncHandler(async (req, res) => ok(res, profileData(await profileService.updateMine(req.user, req.body)), 'Profile updated')),
  completeOnboarding: asyncHandler(async (req, res) => ok(res, profileData(await profileService.completeOnboarding(req.user, req.body)), 'Onboarding completed')),
  getPublic: asyncHandler(async (req, res) => {
    const profile = await profileService.getPublicFreelancer(req.params.userId);
    return ok(res, { profile: { ...profile.toJSON(), type: 'freelancer' } });
  }),
  listTalent: asyncHandler(async (req, res) => {
    const result = await profileService.listPublicFreelancers(req.query);
    return ok(res, {
      items: result.items.map((profile) => ({ ...profile.toJSON(), type: 'freelancer' })),
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
      },
    });
  }),
};
