# Giggo Backend

Phase 1 provides the authentication API used by the Giggo frontend.

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
