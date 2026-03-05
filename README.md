# TraceCase

QA Test Case & Regression Pack Generator (B2B SaaS MVP).

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.example .env.local
```

3. Fill `.env.local` with your Clerk credentials from the Clerk Dashboard API keys page:

```bash
DATABASE_URL=YOUR_NEON_POSTGRES_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
INNGEST_DEV=1
# Optional: set explicitly if localhost resolution is flaky
INNGEST_BASE_URL=http://127.0.0.1:8288
```

4. Apply database migrations:

```bash
npm run db:migrate
```

5. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Auth Routes
- Public: `/`, `/sign-in`, `/sign-up`, `/api/inngest`
- Protected: all other routes (including `/dashboard`)
- Route protection is enforced in `proxy.ts` using `clerkMiddleware()`

## Database Setup

1. Create a Postgres database in Neon.
2. Set `DATABASE_URL` in `.env.local` at the project root (`/Users/anweshsingh/Downloads/TraceCase/.env.local`).
3. Apply the existing Prisma migrations:

```bash
npm run db:migrate
```

4. Open Prisma Studio (optional):

```bash
npm run db:studio
```

On first signed-in visit to `/dashboard`, a personal workspace and OWNER membership are auto-provisioned.

## Requirements (MVP)

- Routes:
  - `/dashboard/requirements` (list, workspace-scoped)
  - `/dashboard/requirements/new` (create)
  - `/dashboard/requirements/[id]` (detail + edit + archive/unarchive)
- RBAC:
  - Everyone can view list/detail.
  - Only users with `requirement:edit` can create/update/archive/unarchive.
- Auditing:
  - Requirement writes create `AuditEvent` rows for:
    - `requirement.created`
    - `requirement.updated`
    - `requirement.archived`
    - `requirement.unarchived`
- Snapshots:
  - Each requirement has immutable source snapshots with per-requirement versioning.
  - Version `v1` is created at requirement creation.
  - On update, a new snapshot is created only if `source_text` changed and hash differs from latest snapshot.
  - Editing only metadata fields (title/module/test_focus) does not create a new snapshot.

## Pack JSON Schema v1.0

- Canonical pack schema and deterministic validator are implemented in `server/packs`.
- Validation enforces ID formats, uniqueness, referential integrity, sequential steps, and source reference constraints.
- Example valid pack JSON is included at `server/packs/examples/examplePack.json`.

## Async Pack Generation (MVP)

- Pack generation is asynchronous via Inngest using a placeholder server-side generator (no real LLM yet).
- Trigger generation from `/dashboard/requirements/[id]` using **Generate Draft Pack**.
- The requirement detail page shows the latest generation jobs and links to generated packs.
- Pack content is validated with `validatePackContent()` before persistence, and canonical JSON is stored in `Pack.content_json`.
- Requirement detail job status is rendered with fresh server data and auto-refreshes while the newest job is `QUEUED`/`RUNNING`, so status moves to `SUCCEEDED` without manual hard refresh.

## Pack Review v1

- Route: `/dashboard/packs/[packId]/review`
- Side-by-side review layout:
  - Requirement snapshot viewer with version/hash and line-numbered source text
  - Pack JSON editor textarea
- Deterministic validation:
  - **Validate** checks JSON + schema/rules using `validatePackContent()`
  - **Save** stores only canonical validated JSON in `Pack.content_json`
- RBAC:
  - Users with `pack:edit` can validate/save
  - Others get read-only JSON view

## Review Workflow v1

- Approve/Reject actions are available to roles with `pack:approve`.
- Status transitions:
  - `NEEDS_REVIEW` -> `REJECTED`
  - `NEEDS_REVIEW`/`REJECTED` -> `APPROVED`
- Approved packs are locked (immutable):
  - JSON save is blocked server-side
  - Review page shows locked notice and disables save
- Approval/rejection actions are audited:
  - `pack.approved`
  - `pack.rejected`

## Async Export v1

- Exports are requested from `/dashboard/packs/[packId]` and processed in the background via Inngest.
- Only `APPROVED` packs can be exported.
- Requires `export:download` permission to request/download exports.
- Export History on the pack page shows latest status (`QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`) and failures.
- On success, CSV payload is stored temporarily in DB (`Export.content_text`) and downloaded via:
  - `GET /api/exports/[exportId]/download`
- Async exports are audited with:
  - `pack.export_requested`
  - `pack.export_job_succeeded` / `pack.export_job_failed`
  - `pack.exported`
- Existing sync route remains available for direct export if needed:
  - `GET /api/packs/[packId]/export?kind=scenarios|test_cases|api_checks|sql_checks|etl_checks`

## Audit Log UI

- Route: `/dashboard/audit`
- Workspace-scoped audit trail (all queries scoped by active `workspace_id`)
- RBAC:
  - Allowed: `OWNER`, `ADMIN`, `REVIEWER` (`audit:view`)
  - Blocked: `EDITOR` (redirects to `/forbidden`)
- Server-rendered filters via query params:
  - `action`
  - `entityType`
  - `entityId`
  - `actorClerkUserId`
  - `limit` (`25`, `50`, `100`)
- Metadata is shown as compact, truncated JSON for safety.

## Inngest Dev

Required local dev env:

```bash
INNGEST_DEV=1
```

Optional (recommended on some machines):

```bash
INNGEST_BASE_URL=http://127.0.0.1:8288
```

Run the app and Inngest dev server in separate terminals:

```bash
npm run dev
```

```bash
npm run inngest:dev
```

The Inngest dev server command runs:

```bash
npx --yes inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Quick verification for async exports:
1. Open an `APPROVED` pack at `/dashboard/packs/[packId]`.
2. Click `Request Test Cases CSV`.
3. Confirm Export History shows `QUEUED/PROCESSING` then `SUCCEEDED`.
4. Click `Download` on the succeeded row.

Quick verification for fresh job status:
1. Open `/dashboard/requirements/[id]` and click **Generate Draft Pack**.
2. Confirm inline banner shows generation started.
3. Confirm newest job transitions from `QUEUED`/`RUNNING` to `SUCCEEDED` on its own (no manual browser refresh).

## Build

```bash
npm run build
```

## MVP Smoke Test Checklist

1. Create a requirement.
2. Verify snapshot rendering on requirement detail.
3. Generate a draft pack.
4. Review/edit JSON, then validate and save.
5. Reject the pack, then approve it (confirm lock state).
6. Export CSV via sync route and async export history flow.
7. Open Audit Log and verify filtered events.

## Manual Test Checklist

1. Set `DATABASE_URL` in `.env.local`.
2. Run `npm run db:migrate`.
3. Load `/`.
4. Click **Go to Dashboard** and confirm redirect to `/sign-in` when signed out.
5. Sign up/sign in and confirm landing on `/dashboard`.
6. Confirm workspace info is rendered on `/dashboard`.
7. Refresh `/dashboard` twice and confirm workspace id remains the same.
8. Optional: open Prisma Studio and confirm `Workspace` and `Membership` rows exist.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS
- shadcn/ui
- Clerk (`@clerk/nextjs`)
- Prisma + Neon Postgres

## Next Milestone

MVP polish pass (empty states, error banners, nav cleanup).
