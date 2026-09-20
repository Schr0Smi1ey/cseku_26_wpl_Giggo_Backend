import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { profileService } from '../services/profile.service.js';
import { readAvatar } from '../services/avatar.storage.service.js';

function profileData({ profile, type }, { includeCv = true } = {}) {
  const data = profile.toJSON();
  if (!includeCv) {
    delete data.cv;
  } else if (data.cv) {
    const { storageKey: _storageKey, ...safeCv } = data.cv;
    data.cv = safeCv;
  }
  return { profile: { ...data, type } };
}

export const profileController = {
  getMine: asyncHandler(async (req, res) => ok(res, profileData(await profileService.getMine(req.user)))),
  updateMine: asyncHandler(async (req, res) => ok(res, profileData(await profileService.updateMine(req.user, req.body)), 'Profile updated')),
  completeOnboarding: asyncHandler(async (req, res) => ok(res, profileData(await profileService.completeOnboarding(req.user, req.body)), 'Onboarding completed')),
  uploadAvatar: asyncHandler(async (req, res) => ok(res, await profileService.uploadAvatar(req.user, req.file), 'Profile photo updated')),
  removeAvatar: asyncHandler(async (req, res) => ok(res, await profileService.removeAvatar(req.user), 'Profile photo removed')),
  serveAvatar: asyncHandler(async (req, res) => {
    const avatar = await readAvatar(req.params.filename);
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': avatar.mimeType,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(avatar.buffer);
  }),
  uploadCv: asyncHandler(async (req, res) => ok(res, profileData(await profileService.uploadCv(req.user, req.file)), 'CV uploaded')),
  removeCv: asyncHandler(async (req, res) => ok(res, profileData(await profileService.removeCv(req.user)), 'CV removed')),
  getPublic: asyncHandler(async (req, res) => {
    const profile = await profileService.getPublicFreelancer(req.params.userId);
    return ok(res, profileData({ profile, type: 'freelancer' }, { includeCv: false }));
  }),
  listTalent: asyncHandler(async (req, res) => {
    const result = await profileService.listPublicFreelancers(req.query);
    return ok(res, {
      items: result.items.map((profile) => profileData({ profile, type: 'freelancer' }, { includeCv: false }).profile),
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
      },
    });
  }),
};
