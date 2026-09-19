# Giggo Backend

Giggo currently implements backend support through Phase 5: Supabase-authenticated
accounts, role-specific profiles, CV analysis, verification, and the job marketplace.

1. Copy `.env.example` to `.env` and replace the JWT placeholder values.
2. Run `npm install`.
3. Run `npm run dev`.

With `MONGODB_URI` empty in development, the server uses an ephemeral local
MongoDB instance. Use a real MongoDB URI when persistent local data is needed.

## Phase 1 endpoints

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Phase 2 endpoints

- `GET /api/profiles/me`
- `PATCH /api/profiles/me`
- `POST /api/profiles/me/onboarding`
- `GET /api/profiles/talent`
- `GET /api/profiles/:userId`

## Verification and trust endpoints

Verification is human-reviewed. A CV analyzer or other automated feature can never approve a request or grant a badge.

- `GET /api/verification/status`
- `POST /api/verification/email/resend` and `POST /api/auth/verify-email`
- `POST /api/verification/phone/send` and `POST /api/verification/phone/verify`
- `POST|GET|DELETE /api/verification/requests`
- Admin only: `GET /api/verification/admin/requests`, `POST /api/verification/admin/requests/:id/decision`

Verification documents are private files under `.runtime/`; only an authenticated administrator can download a submitted document. Development email and phone confirmations return one-time values so the flow can be demonstrated without mail or SMS infrastructure.

To provision a local reviewer without exposing an admin registration endpoint, set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in your untracked `.env`, then run `npm run bootstrap:admin`. This command requires `MONGODB_URI` and is never run automatically.

## Phase 3 endpoints

- `POST|DELETE /api/profiles/me/cv` stores a private freelancer CV. PDF/Word files
  are retained for review; paste their text into the analyzer unless server-side
  extraction is configured.
- `POST /api/ai/cv/analyze`, `GET /api/ai/cv/latest`, and `GET|DELETE /api/ai/cv/analyses/:id`
- `POST /api/ai/cv/analyses/:id/apply-skills` explicitly merges suggested skills.

The default `heuristic` provider is deterministic and keeps CV text local. Any hosted
provider must be implemented server-side with a private credential and structured output validation.

## Phase 5 endpoints

- Public: `GET /api/jobs`, `GET /api/jobs/:id`
- Client: `POST /api/jobs`, `GET /api/jobs/mine`, `PATCH|DELETE /api/jobs/:id`
- Freelancer: `POST|DELETE /api/jobs/:id/save`, `GET /api/jobs/saved`
