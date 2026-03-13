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
APP_ENV=local
AI_PROVIDER=placeholder
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
OPENAI_STORE=false
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
INNGEST_DEV=1
# Optional: set explicitly if localhost resolution is flaky
INNGEST_BASE_URL=http://127.0.0.1:8288
# Required when INNGEST_DEV is not 1
INNGEST_EVENT_KEY=YOUR_INNGEST_EVENT_KEY
RATE_LIMIT_STORE=memory
# Required when RATE_LIMIT_STORE=redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

4. Apply database migrations:

```bash
npm run db:migrate
```

5. Validate environment variables:

```bash
npm run check-env
```

6. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environments

- `APP_ENV` controls the environment profile and defaults to `local`.
- Local env file: `.env.local` (recommended from `.env.example`).
- Staging env file: `.env.staging.local` (private, gitignored).

Run staging locally with:

```bash
npm run staging:dev
```

Create staging values first:

```bash
cp .env.staging.example .env.staging.local
```

Then update `.env.staging.local` with real values:

- `DATABASE_URL` must point to a real staging Postgres database.
- `INNGEST_EVENT_KEY` must be set unless you explicitly set `INNGEST_DEV=1`.

If you want a quick local-only staging smoke run with your local DB, you can temporarily set:

```bash
INNGEST_DEV=1
DATABASE_URL=<your .env.local DATABASE_URL>
```

## Backup & Restore

- Runbook: [`docs/runbooks/db-backup-restore.md`](./docs/runbooks/db-backup-restore.md)
- Backup commands:

```bash
npm run db:backup
```

- Restore commands:

```bash
BACKUP_FILE=./backups/tracecase_local_YYYYMMDD_HHMMSS.sql.gz \
CONFIRM_DROP=1 \
npm run db:restore
```

- Verify and health-check:

```bash
npm run db:verify
curl http://localhost:3000/api/health
```

## Auth Routes
- Public: `/`, `/sign-in`, `/sign-up`, `/api/inngest`, `/api/health`
- Protected: all other routes (including `/dashboard`)
- Route protection is enforced in `proxy.ts` using `clerkMiddleware()`

## Health Endpoint

- Route: `GET /api/health` (public)
- Example:

```bash
curl http://localhost:3000/api/health
```

- Response fields:
  - `status`: `ok` or `degraded`
  - `timestamp` (ISO)
  - `version`
  - `commit_sha` (when available in CI/runtime env)
  - `checks`:
    - `db`
    - `env`
    - `inngest`
    - `clerk`
    - `openai`
- `503` means at least one essential check failed (environment validation and/or database connectivity).

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

## Demo Setup

- Seed helper creates a demo workspace and two seeded requirements with snapshots (idempotent):

```bash
npm run db:seed
npm run db:verify
```

- Staging equivalents:

```bash
npm run staging:db:seed
npm run staging:db:verify
```

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

## Grounding Inputs (Artifacts)

- Requirement Artifacts are pasted grounding inputs attached to a specific requirement snapshot.
- Current artifact types:
  - `OPENAPI`
  - `PRISMA_SCHEMA`
- Add them from the requirement detail page in the **Artifacts** panel by pasting text and saving.
- Each artifact is stored with a content hash and is parsed on save.
- `OPENAPI` artifacts show valid/invalid state using YAML/JSON parsing plus OpenAPI validation. TraceCase stores a compact summary with the detected format, version, operation count, and sorted `{ method, path }` operations.
- `PRISMA_SCHEMA` artifacts show valid/invalid state using Prisma schema parsing. TraceCase stores a compact summary with model count plus sorted models and field types.
- Parse summaries are stored in `RequirementArtifact.metadata_json`. They intentionally avoid full parser dumps or raw content copies.
- Manual test note:
  - paste a valid and invalid OpenAPI artifact, then a valid and invalid Prisma schema artifact, and confirm the row badge flips between `Valid` / `Invalid` and the summary line updates after save.

## Pack JSON Schema v1.0

- Canonical pack schema and deterministic validator are implemented in `server/packs`.
- Validation enforces ID formats, uniqueness, referential integrity, sequential steps, and source reference constraints.
- Example valid pack JSON is included at `server/packs/examples/examplePack.json`.

## Async Pack Generation (MVP)

- Pack generation is asynchronous via Inngest.
- Default mode (`AI_PROVIDER=placeholder`) keeps the existing placeholder server-side generator for local development and deterministic smoke runs.
- Trigger generation from `/dashboard/requirements/[id]` using **Generate Draft Pack**.
- The requirement detail page shows the latest generation jobs and links to generated packs.
- Pack content is validated with `validatePackContent()` before persistence, and canonical JSON is stored in `Pack.content_json`.
- Requirement detail job status is rendered with fresh server data and auto-refreshes while the newest job is `QUEUED`/`RUNNING`, so status moves to `SUCCEEDED` without manual hard refresh.

## AI Pack Generation (Real LLM)

- Enable real LLM-backed generation by setting `AI_PROVIDER=openai` and `OPENAI_API_KEY` on the server. The client never calls OpenAI directly.
- `OPENAI_MODEL` is configurable and defaults to `gpt-5-mini`.
- Requests are sent with `store: false` by default. Override only if you intentionally set `OPENAI_STORE=true`.
- The OpenAI path uses Responses API structured outputs locked to Pack JSON Schema v1.0, then runs deterministic `validatePackContent()` before persistence.
- A second server-side critic call checks requirement coverage and genericity. If the critic finds uncovered acceptance criteria or weak/generic coverage, TraceCase performs one repair generation attempt, validates again, re-runs the critic, and stores the final critic report in `Job.metadata_json.ai`.
- When a valid `OPENAPI` artifact exists for the target requirement snapshot, TraceCase passes the parsed operation list into generation, validates generated API checks against grounded `{ method, path }` operations, repairs once if mismatches are found, and fails safely if mismatches remain after repair.
- When a valid `PRISMA_SCHEMA` artifact exists for the target requirement snapshot, TraceCase passes the parsed model/field summary into generation, validates concrete SQL checks against grounded Prisma models/fields, repairs once if mismatches are found, and then downgrades any still-unsafe concrete SQL checks into semantic `needs schema mapping` checks instead of bluffing unsupported schema details.
- If no valid `OPENAPI` artifact exists for that snapshot, generation continues unchanged and records grounding as `skipped` in `Job.metadata_json.ai.grounding.openapi`.
- If no valid `PRISMA_SCHEMA` artifact exists for that snapshot, generation continues unchanged and records grounding as `skipped` in `Job.metadata_json.ai.grounding.prisma`.
- Manual grounding note:
  - attach a valid `OPENAPI` artifact to the latest snapshot, generate a pack, and inspect `Job.metadata_json.ai.grounding.openapi` for `status`, `artifact_id`, grounded counts, and any mismatch details.
  - for a mismatch smoke test, use an artifact that omits an endpoint the requirement implies and confirm the job repairs once, then fails safely if grounded API checks still do not match.
  - attach a valid `PRISMA_SCHEMA` artifact to the latest snapshot, generate a pack, and inspect `Job.metadata_json.ai.grounding.prisma` for `status`, `artifact_id`, grounded counts, semantic-count fallback, and any mismatch details.

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

## Rate Limiting + Idempotency

- Server-side rate limiting is enforced with a local memory store by default (`RATE_LIMIT_STORE=memory`).
- Protected actions:
  - Generate draft pack request (`3` requests / `60s` per user + requirement)
  - Async export request (`10` requests / `60s` per user + pack + kind)
  - Requirement writes create/update/archive/unarchive (`30` requests / `60s` per user + workspace)
  - CSV download endpoints (`60` requests / `60s` per user + workspace)
- Idempotency guards prevent duplicate in-flight work:
  - Generation request dedupes if an active generation job already exists
  - Export request dedupes if an active export for the same `pack + kind` already exists
- Future Redis backend:
  - Set `RATE_LIMIT_STORE=redis`
  - Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
  - Current MVP keeps Redis as a planned swap-in (memory store is active today)

## Request IDs + Structured Logs

- Every request gets an `x-request-id` in `proxy.ts` (preserved if already provided).
- The same `x-request-id` is forwarded to server handlers and echoed in responses.
- WS#2 routes/actions now return safe error messages with `request_id` so failures are traceable.
- Structured logs are JSON with stable fields (`timestamp`, `level`, `msg`, `request_id`, action/workspace/entity metadata).
- Example log line:

```json
{"timestamp":"2026-03-05T22:10:41.123Z","level":"warn","msg":"rate_limited","request_id":"3d5d8b2b-2fd8-4d86-9f90-16b2e20a26f3","workspace_id":"ws_123","actor_clerk_user_id":"user_123","action":"rate_limited","metadata":{"key":"rl:pack_generate:ws_123:user_123:req_123","retry_after_seconds":41}}
```

## CI

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Runs on `push` and `pull_request`.
- CI pipeline steps:
  1. `npm ci`
  2. `npm run check-env`
  3. `npm run db:migrate:ci` (Prisma migrate deploy on CI Postgres service)
  4. `npm test`
  5. `npm run build`
  6. `npm run lint --if-present`

## Build

```bash
npm run build
```

## MVP Smoke Test Checklist

1. Create a requirement.
2. Verify snapshot rendering on requirement detail.
3. Generate a draft pack.
4. Set `AI_PROVIDER=openai` and generate a pack; confirm it contains acceptance-criteria-specific cases instead of generic form-submission spam.
5. Inspect the generation `Job.metadata_json` and confirm critic coverage plus attempt count are present.
6. Review/edit JSON, then validate and save.
7. Reject the pack, then approve it (confirm lock state).
8. Export CSV via sync route and async export history flow.
9. Open Audit Log and verify filtered events.
10. Open `/api/health` and confirm status is `ok`.
11. Spam-click **Generate Draft Pack** and confirm only one active job remains (or rate limit feedback appears).
12. Spam-click async export request and confirm dedupe and/or rate-limit feedback.
13. Open `/api/health` to confirm status remains healthy after exercise.

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

Phase 0 Workstream #3: staging readiness + backup/restore runbook.
