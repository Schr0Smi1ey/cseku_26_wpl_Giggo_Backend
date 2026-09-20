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
- `DELETE /api/auth/account`

Permanent account deletion requires a recently issued Supabase session and the
exact confirmation text `DELETE`. The backend removes the Supabase identity and
Giggo-owned profile, CV, analysis, verification, job, saved-job, and session
records. Configure `SUPABASE_SERVICE_ROLE_KEY` only in the backend's ignored
`.env`; never put it in a Vite variable or frontend repository. Administrator
accounts cannot use this self-service deletion route. If an ImgBB avatar was
used, Giggo detaches it but cannot confirm deletion of the provider's copy.

## Phase 2 endpoints

- `GET /api/profiles/me`
- `PATCH /api/profiles/me`
- `POST /api/profiles/me/onboarding`
- `POST|DELETE /api/profiles/me/avatar`
- `GET /api/profiles/avatars/:filename`
- `GET /api/profiles/talent`
- `GET /api/profiles/:userId`

Profile photos accept JPEG, PNG, or WebP images up to the configured limit.
Opaque public URLs are stored on the account while filesystem paths remain
server-only. Set `AVATAR_STORAGE_PROVIDER=imgbb` and configure the server-only
`IMGBB_API_KEY` to use ImgBB; otherwise files remain under `.runtime/` locally.
Replacing or removing a locally stored photo cleans up the previous file.
ImgBB's v1 upload API returns a private deletion link but does not document a
server-side deletion endpoint, so removal detaches the photo from Giggo while
the provider may retain its hosted copy.

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

When a valid freelancer access token is present, `GET /api/jobs` includes that
user's applied/followed state on each result. The optional
`activity=applied|followed` query returns the corresponding personal job set;
using an activity filter requires a freelancer account.

## Proposal creation endpoints

- Freelancer: `POST /api/proposals`, `GET /api/proposals/mine`
- Freelancer: `GET /api/proposals/jobs/:jobId/mine`, `PATCH /api/proposals/:id`
- Freelancer: `POST /api/proposals/:id/withdraw`
- Client: `GET /api/proposals/received`, `POST /api/proposals/:id/decision`
- Participant: `GET /api/proposals/:id`
- Freelancer draft assistant: `POST /api/ai/proposal/draft`

Proposal submission accepts a cover letter, bid, estimated duration, optional
milestones, and an AI-assistance disclosure. The server accepts proposals only
from freelancer accounts, only for open jobs, and enforces one proposal per
freelancer and job. Active proposals can be revised or withdrawn, and a
withdrawn proposal can be resubmitted without creating a duplicate record. Job
owners can privately shortlist, reject, or reconsider proposals, but hiring is
reserved for the offer and contract workflow. The local draft assistant returns
an editable, profile-grounded suggestion and never creates a proposal.
