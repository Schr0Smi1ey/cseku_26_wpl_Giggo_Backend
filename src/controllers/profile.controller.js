import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { profileService } from '../services/profile.service.js';

function profileData({ profile, type }) {
  const data = profile.toJSON();
  if (data.cv) {
    // Storage paths are server implementation details and must never be exposed.
    const { storageKey: _storageKey, ...cv } = data.cv;
    data.cv = cv;
  }
  return { profile: { ...data, type } };
}

export const profileController = {
  getMine: asyncHandler(async (req, res) => ok(res, profileData(await profileService.getMine(req.user)))),
  updateMine: asyncHandler(async (req, res) => ok(res, profileData(await profileService.updateMine(req.user, req.body)), 'Profile updated')),
  completeOnboarding: asyncHandler(async (req, res) => ok(res, profileData(await profileService.completeOnboarding(req.user, req.body)), 'Onboarding completed')),
  uploadCv: asyncHandler(async (req, res) => ok(res, profileData(await profileService.uploadCv(req.user, req.file)), 'CV uploaded')),
  removeCv: asyncHandler(async (req, res) => ok(res, profileData(await profileService.removeCv(req.user)), 'CV removed')),
  getPublic: asyncHandler(async (req, res) => {
    const profile = await profileService.getPublicFreelancer(req.params.userId);
    return ok(res, profileData({ profile, type: 'freelancer' }));
  }),
  listTalent: asyncHandler(async (req, res) => {
    const result = await profileService.listPublicFreelancers(req.query);
    return ok(res, {
      items: result.items.map((profile) => profileData({ profile, type: 'freelancer' }).profile),
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
      },
    });
  }),
};
