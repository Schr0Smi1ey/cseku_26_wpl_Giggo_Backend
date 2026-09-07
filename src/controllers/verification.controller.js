import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { verificationService } from '../services/verification.service.js';

export const verificationController = {
  status: asyncHandler(async (req, res) => ok(res, await verificationService.getStatus(req.user))),
  resendEmail: asyncHandler(async (req, res) => ok(res, await verificationService.resendEmail(req.user), 'Verification email sent')),
  sendPhone: asyncHandler(async (req, res) => ok(res, await verificationService.sendPhoneCode(req.user, req.body), 'Verification code sent')),
  verifyPhone: asyncHandler(async (req, res) => ok(res, await verificationService.verifyPhoneCode(req.user, req.body), 'Phone verified')),
  submitRequest: asyncHandler(async (req, res) => {
    const request = await verificationService.submitRequest(req.user, req.body, req.files || []);
    return ok(res, { request: request.toJSON() }, 'Verification request submitted', 201);
  }),
  myRequests: asyncHandler(async (req, res) => {
    const requests = await verificationService.myRequests(req.user);
    return ok(res, { requests: requests.map((request) => request.toJSON()) });
  }),
  cancelRequest: asyncHandler(async (req, res) => {
    const request = await verificationService.cancelRequest(req.user, req.params.id);
    return ok(res, { request: request.toJSON() }, 'Verification request cancelled');
  }),
  adminQueue: asyncHandler(async (req, res) => {
    const result = await verificationService.listQueue(req.query);
    return ok(res, {
      items: result.items.map((request) => request.toJSON()),
      pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / result.limit)) },
    });
  }),
  adminDecide: asyncHandler(async (req, res) => {
    const request = await verificationService.decide(req.user, req.params.id, req.body);
    return ok(res, { request: request.toJSON() }, 'Verification decision recorded');
  }),
  adminDocument: asyncHandler(async (req, res) => {
    const { document, path } = await verificationService.adminDocument(req.params.id, req.params.index);
    res.type(document.mimeType);
    return res.download(path, document.filename);
  }),
};
