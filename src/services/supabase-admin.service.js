import { config } from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';

let testDeleteIdentity;

export function setSupabaseAdminDeleteForTests(handler) {
  if (!config.isTest) throw new Error('Supabase Admin test overrides are unavailable outside the test environment');
  testDeleteIdentity = handler;
}

export async function deleteSupabaseIdentity(supabaseUserId) {
  if (config.isTest && testDeleteIdentity) return testDeleteIdentity(supabaseUserId);
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new ApiError(503, 'Account deletion is not configured', 'ACCOUNT_DELETION_CONFIGURATION_ERROR');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.supabase.adminTimeoutMs);
  try {
    const response = await fetch(`${config.supabase.url}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`, {
      method: 'DELETE',
      headers: {
        apikey: config.supabase.serviceRoleKey,
        Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
      },
      signal: controller.signal,
    });
    if (response.ok || response.status === 404) return;
    throw new ApiError(502, 'The authentication account could not be deleted', 'IDENTITY_DELETION_FAILED');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'The authentication service is temporarily unavailable', 'IDENTITY_DELETION_FAILED');
  } finally {
    clearTimeout(timeout);
  }
}
