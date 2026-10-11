import { createHash } from 'node:crypto';
import { SecuritySession, SecurityEvent } from '../models/SecuritySession.js';
import { ApiError } from '../utils/ApiError.js';
const retention = () => new Date(Date.now() + 30 * 86400000);
export async function enforceSecuritySession(req, identity) {
  if (!identity.sessionId) return; // Older verified tokens have no session claim.
  await SecuritySession.init();
  const sessionHash = createHash('sha256').update(identity.sessionId).digest('hex');
  const ua = String(req.get('User-Agent') || '');
  const device = `${/Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'Mac' : 'Other device'} · ${/Edg\//i.test(ua) ? 'Edge' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Browser'}`;
  let session = await SecuritySession.findOne({ user: req.user._id, sessionHash });
  if (!session) {
    try { session = await SecuritySession.create({ user: req.user._id, sessionHash, device, expiresAt: retention() }); await SecurityEvent.create({ user: req.user._id, type: 'new_session', device, expiresAt: retention() }); }
    catch (e) { if (e.code !== 11000) throw e; session = await SecuritySession.findOne({ user: req.user._id, sessionHash }); }
  }
  if (session.revokedAt) throw ApiError.unauthorized('This Giggo session was revoked. Sign in again.');
  if (Date.now() - session.lastSeenAt.getTime() > 60000) await SecuritySession.updateOne({ _id: session._id, revokedAt: null }, { lastSeenAt: new Date(), expiresAt: retention() });
  req.securitySessionId = session._id;
}
