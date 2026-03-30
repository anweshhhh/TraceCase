# Context

## Project
QA Test Case & Regression Pack Generator (B2B SaaS)

## Goal (MVP)
Requirement/User Story (paste text) → Server-side AI draft test pack → Human review/approval with traceability + audit log → CSV export.

## Decisions Locked
- Auth: Clerk
- AI: server-side only (no client LLM calls)
- Stack: Next.js App Router + TypeScript, Tailwind + shadcn/ui
- DB: Neon Postgres + Prisma
- Multi-tenant-ready data model: all future entities scoped by workspace_id
- RBAC: Owner/Admin/Editor/Reviewer

## Current Status (Implemented)
### App + Auth
- Next.js App Router bootstrapped with Tailwind + shadcn/ui
- Clerk integrated with protected routing via Clerk middleware (public routes: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/inngest(.*)`; everything else protected)
- Pages:
  - Public landing: `/`
  - Auth: `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]`
  - Protected: `/dashboard`
  - Forbidden: `/forbidden` (403)

### Database + Core Tables (Neon + Prisma)
- Prisma wired to Neon via `DATABASE_URL`
- Foundational schema:
  - `Workspace` (supports future Clerk org mapping via `clerk_org_id`; personal workspace via `owner_clerk_user_id`)
  - `Membership` (workspace_id + clerk_user_id + role; unique(workspace_id, clerk_user_id))
  - `AuditEvent` (workspace_id, actor, action, entity refs, metadata_json)
  - `Role` enum: OWNER, ADMIN, EDITOR, REVIEWER
- Migration applied successfully to Neon
- Personal workspace auto-provisioning:
  - On first visit to `/dashboard`, creates a "Personal Workspace" + OWNER membership
  - Subsequent visits reuse (no duplicates)

### RBAC + Authorization
- Central authz module added with:
  - `getAuthContext`, `getActiveWorkspaceContext`
  - `requireRoleAny`, `requireRoleMin` (hierarchy OWNER > ADMIN > EDITOR > REVIEWER)
  - `can(role, permission)` permission map:
    - workspace:manage_members (OWNER, ADMIN)
    - pack:approve (OWNER, ADMIN, REVIEWER)
    - pack:edit (OWNER, ADMIN, EDITOR)
    - requirement:edit (OWNER, ADMIN, EDITOR)
    - export:download (ALL)
- RBAC demo routes:
  - `/dashboard/admin` requires ADMIN-or-higher (OWNER passes)
  - `/dashboard/reviewer-only` allows ONLY REVIEWER (OWNER redirected to /forbidden)
- Nav shows links based on permissions (Admin link gated; reviewer-only link always visible to test forbidden)

### Requirements (Epic 1 / Task 1.1)
- Prisma schema extended with:
  - `Requirement` model (workspace-scoped)
  - `RequirementStatus` enum (`ACTIVE`, `ARCHIVED`)
  - `ModuleType` enum (`GENERIC`, `LOGIN`, `SIGNUP`, `PAYMENTS`, `CRUD`, `API`, `ETL`)
- Requirement migration created and applied to Neon
- Server modules added:
  - `server/requirements.ts` for list/create/get/update/status operations
  - All requirement queries scoped by `workspace_id`
  - Write operations enforce `requirement:edit` permission
  - Zod validation applied for payloads and filters
  - `server/audit.ts` helper to persist audit events
- Requirement audit actions recorded:
  - `requirement.created`
  - `requirement.updated`
  - `requirement.archived`
  - `requirement.unarchived`
- UI routes added under `/dashboard/requirements`:
  - List page with status filter and permission-aware New button
  - New page (create form with Zod + React Hook Form + shadcn/ui)
  - Detail page with read-only vs editable behavior by role
  - Archive/unarchive toggle for users with edit permission
- Error/guard behavior:
  - Unauthorized edits redirect to `/forbidden` (server-side)
  - Missing requirement id shows friendly not-found state

### Requirement Snapshot Versioning (Epic 1 / Task 1.2)
- Prisma schema extended with `RequirementSnapshot`:
  - Immutable snapshot rows with `version`, `source_text`, `source_hash`, actor, and timestamps
  - Constraints: unique(`requirement_id`, `version`) and workspace-scoped indexes
- Snapshot migration created and applied to Neon
- Source text utilities added:
  - `normalizeSourceText` (newline normalization + trailing-space normalization)
  - `hashSourceText` (sha256 hex hash)
  - `buildLineIndex` (1-based line map for traceable display)
- Automatic snapshotting behavior:
  - Requirement create generates snapshot `v1`
  - Requirement update generates new snapshot only when `source_text` changes and hash differs from latest
  - Status archive/unarchive does not generate snapshots
- Snapshot audit events recorded:
  - `requirement.snapshot_created` with `requirement_id`, `version`, and `source_hash`
- Requirement detail page now includes snapshot viewer:
  - Snapshot list with version/date/hash/actor
  - Selectable snapshot read-only text rendering with line numbers
- Unit tests added for source text normalization/hash and line indexing utilities

### Pack Schema + Deterministic Validation (Epic 2 / Task 2.1)
- Canonical Pack JSON schema v1.0 added using Zod:
  - `schema_version`
  - `source` binding to requirement snapshot metadata
  - `assumptions`, `clarifying_questions`, `scenarios`, `test_cases`, `checks`
- Deterministic pack validation utilities added:
  - Canonicalization of optional checks arrays to `[]`
  - ID uniqueness checks within arrays
  - Referential integrity: `test_case.scenario_id` must exist
  - Sequential step numbering (`step_no` starts at 1 with no gaps)
  - Source refs constraints (`line_start <= line_end`, both >= 1)
  - Source refs snapshot binding to `source.requirement_snapshot_id`
- Example valid pack JSON added at `server/packs/examples/examplePack.json`
- Unit tests added for:
  - Valid example pack
  - Non-sequential step rejection
  - Missing scenario reference rejection

### Async Pack Generation + Persistence (Epic 2 / Task 2.2)
- Prisma schema extended with async generation entities:
  - `Pack` model for persisted generated content (`content_json`, `schema_version`, review status)
  - `Job` model for async workflow state (`QUEUED`/`RUNNING`/`SUCCEEDED`/`FAILED`)
  - Enums: `PackStatus`, `JobStatus`
- Migration created and applied to Neon for `Pack` and `Job` tables.
- Inngest wired into Next.js App Router:
  - Inngest client at `src/inngest/client.ts`
  - Inngest route handler at `app/api/inngest/route.ts`
  - `generate_pack` function at `src/inngest/functions/generatePack.ts`
- Placeholder generator implemented (server-only):
  - `server/packs/generatePlaceholderPack.ts`
  - Produces schema-valid pack content tied to requirement snapshot source metadata
  - Validated via `validatePackContent()` and persisted as canonical JSON
- Requirement detail UX extended:
  - "Generate Draft Pack" button visible only for users with `pack:edit`
  - Creates `Job` row, dispatches Inngest event, and shows status feedback
  - "Generation Jobs" section lists latest 5 jobs with status and pack links
- Pack viewer route added:
  - `/dashboard/packs/[packId]` workspace-scoped, read-only JSON view
- Audit events added around generation lifecycle:
  - `job.queued`, `job.succeeded`, `job.failed`, `pack.generated`
- Unit test coverage extended:
  - Placeholder generator returns schema-valid content.

### Phase 1 / Workstream #1: Real AI Pack Generation
- Added OpenAI-backed server-only generation path gated by `AI_PROVIDER=openai`:
  - `server/ai/openaiClient.ts`
  - `server/packs/generateAiPack.ts`
  - `server/packs/critiquePack.ts`
- Pack generation now uses Responses API structured outputs locked to Pack JSON Schema v1.0 and still persists only canonical output from `validatePackContent()`.
- Added critic + one-shot auto-repair loop:
  - critic checks requirement coverage and genericity
  - uncovered acceptance criteria or generic coverage trigger a single repair attempt
  - hard cap stays at 2 total generations (initial + 1 repair)
- Final critic summary is stored on the generation job in `Job.metadata_json`:
  - `ai_mode`
  - `ai.provider`
  - `ai.model`
  - `ai.attempts`
  - `ai.critic`
  - `ai.token_usage` when available
- Placeholder mode remains the default for local/dev parity and still uses the existing deterministic placeholder generator.

### Inngest Dispatch Reliability Fix
- Root cause identified from persisted failed jobs:
  - `Inngest API Error: 401 Event key not found` when dispatching without local dev mode/event key.
  - `fetch failed` when local dev mode was enabled but the Inngest dev endpoint was not reachable.
- Inngest client updated to be explicit for local dev:
  - Uses `INNGEST_DEV=1` to enable dev mode.
  - Uses `INNGEST_BASE_URL` when provided.
  - Falls back to `http://127.0.0.1:8288` in dev mode when base URL is not set.
- Dispatch failure observability improved:
  - On dispatch failure, `Job.status` is set to `FAILED` and `Job.error` stores a safe truncated message (max 800 chars).
  - Audit event `job.dispatch_failed` is recorded with safe metadata (`job_id`, reason).
  - Requirement detail "Generation Jobs" now renders `Job.error` for failed jobs.
- Local run expectation documented:
  - `.env.local`: set `INNGEST_DEV=1` and optional `INNGEST_BASE_URL=http://127.0.0.1:8288`
  - Terminal 1: `npm run dev`
  - Terminal 2: `npm run inngest:dev`

### Requirement Job Status Freshness Fix
- Fixed stale `Generation Jobs` status on requirement detail pages:
  - Requirement detail route is now forced dynamic (`dynamic = "force-dynamic"`), preventing stale server-component caching for job status.
  - Existing `revalidatePath("/dashboard/requirements/[id]")` on generation action remains in place before redirect.
  - Added a tiny client helper that calls `router.refresh()` every 2s while newest job is `QUEUED`/`RUNNING`.
- Result:
  - After clicking **Generate Draft Pack**, page shows "Generation started" and updates to `SUCCEEDED` automatically without manual hard refresh.

### UX Hardening Pass - Sticky Header Refinement
- Requirement detail page sticky chrome was reduced to the decision-critical layer only:
  - requirement title
  - requirement status
  - single OpenAPI/API grounding readiness signal
  - latest snapshot badge
  - primary generate action
- Detailed OpenAPI and Prisma readiness notes now live in a separate non-sticky `Generation readiness` panel so long pages keep more vertical room.
- Pack viewer header is no longer sticky; it remains readable but no longer steals viewport height from the raw JSON/content area.

### UX Hardening Pass - Generation Job Hierarchy Refinement
- Requirement detail generation jobs now distinguish the latest run from older history:
  - latest run gets a larger summary card with actionable status and details
  - older jobs are compressed into lighter history rows
- Added shared summary-copy helper logic in `lib/packUx.ts` so job-state language remains deterministic and unit tested.

### UX Hardening Pass - Generation Evidence Block
- Requirement detail latest-job card now includes a dedicated `Generation evidence` block.
- The evidence block surfaces compact proof from job metadata:
  - critic coverage
  - repair attempts
  - OpenAPI grounding status
  - grounded API checks
  - available grounded operations
- This makes grounded generation quality visible in-product without opening Prisma Studio.

### UX Hardening Pass - Evidence Collapse Refinement
- `Generation evidence` on the latest-job card now uses the same expandable pattern as `Job details`.
- The collapsed summary line keeps key proof visible:
  - coverage
  - grounding status
  - API check grounding count

### UX Hardening Pass - Evidence Summary Cleanup
- Removed the redundant collapsed evidence summary text from the latest-job card.
- `Generation evidence` now stays compact until expanded, which avoids repeating proof already visible inside the expanded panel.

### UX Hardening Pass - Latest Run Simplification
- Simplified the active-generation banner to a lightweight progress message plus jump link.
- Latest-run UI now uses a single `Details` disclosure instead of separate evidence and job-details disclosures.
- Copy/debug fields were moved out of the collapsed latest-run summary so the first-glance state stays concise.

### Phase 1 / Workstream 2C.2 - Prisma Grounding Gate
- Added Prisma grounding lookup for the latest valid `PRISMA_SCHEMA` artifact on the target requirement snapshot.
- AI generation now receives compact grounded Prisma model/field context when available.
- Concrete SQL checks are validated against grounded Prisma models/fields:
  - supported checks remain grounded
  - unsupported concrete checks trigger one repair attempt
  - if still unsupported after repair, they are downgraded to semantic `NEEDS_MAPPING:` checks instead of bluffing exact schema details
- Final grounding proof is stored in `Job.metadata_json.ai.grounding.prisma`.
- Next phase: expose Prisma grounding proof and semantic fallback more clearly in the review UI.

### Pack Review v1 (Human Edit + Deterministic Validation)
- Added scoped pack repository module:
  - `getPack(workspaceId, packId)`
  - `updatePackContent(workspaceId, actorId, packId, newContentJson)`
  - All pack queries/updates are scoped by `workspace_id`
- Save path enforces deterministic validation:
  - Parses JSON
  - Validates with `validatePackContent()`
  - Persists only canonical output to `Pack.content_json`
  - Updates `schema_version` from canonical payload (`1.0`)
- Audit logging added for edits:
  - `pack.edited` with `entity_type="Pack"`, `entity_id=packId`, metadata `{ schema_version }`
- New review route:
  - `/dashboard/packs/[packId]/review`
  - Two-column layout:
    - Left: requirement snapshot viewer (version/hash + line-numbered source text)
    - Right: Pack JSON textarea editor with Validate + Save flow
- Error handling and UX:
  - Friendly invalid JSON parse errors
  - Friendly schema/deterministic validation errors (no crash)
  - `?saved=1` success banner after save
- RBAC gating:
  - `pack:edit` users can validate/save
  - Non-edit users see read-only JSON and no Save button
- Pack viewer enhancements:
  - `/dashboard/packs/[packId]` shows `Review / Edit` button for `pack:edit`
  - Always includes `Back to Requirement` link

### Review Workflow v1 (Approve / Reject + Locking)
- Added server-side pack status transition helpers:
  - `approvePack(workspaceId, actorId, packId)`
  - `rejectPack(workspaceId, actorId, packId, reason?)`
  - Transitions enforced:
    - Approve: `NEEDS_REVIEW` or `REJECTED` -> `APPROVED`
    - Reject: `NEEDS_REVIEW` -> `REJECTED` (from `REJECTED` is no-op)
    - `APPROVED` is terminal for MVP
- Added immutable lock enforcement:
  - `updatePackContent(...)` now blocks writes when `Pack.status === APPROVED`
  - Friendly error returned to review UI for locked packs
- Added review actions:
  - `approvePackAction`
  - `rejectPackAction`
  - Permission-gated by `can(role, "pack:approve")`, unauthorized users redirect to `/forbidden`
  - Revalidates pack viewer/review routes and redirects with `?approved=1`, `?rejected=1`, or `?action_error=...`
- Review page updated:
  - Prominent status badge + action buttons (Approve/Reject) when allowed
  - Approved packs show "Approved (locked)" notice
  - Save disabled/blocked for approved status
  - Success/error banners for saved/approved/rejected/action errors
- Pack viewer updated:
  - Shows approval metadata when approved:
    - `approved_by_clerk_user_id`
    - `approved_at`
  - Displays locked note for approved packs
- Audit events added:
  - `pack.approved`
  - `pack.rejected`
- Added unit tests for transition guards:
  - approved lock guard rejects edits
  - approve transition produces APPROVED metadata

### CSV Export v1 (Synchronous, Approved-Only)
- Added CSV mapping utilities in `server/exports/packCsv.ts`:
  - `buildScenariosCsv`
  - `buildTestCasesCsv`
  - `buildApiChecksCsv`
  - `buildSqlChecksCsv`
  - `buildEtlChecksCsv`
- CSV behavior:
  - Stable column ordering
  - Proper escaping for commas, quotes, and newlines
  - Array flattening with ` | `
  - Compact source refs format: `snapshot_id:line_start-line_end`
- Added export API route:
  - `GET /api/packs/[packId]/export?kind=scenarios|test_cases|api_checks|sql_checks|etl_checks`
  - Enforces Clerk auth, active workspace scoping, and `export:download` RBAC
  - Rejects non-approved packs with friendly error
  - Returns direct file download response (`text/csv`)
- Added export audit logging:
  - `pack.exported` with metadata `{ kind }`
- Updated pack viewer (`/dashboard/packs/[packId]`):
  - New Exports section
  - Export actions shown only when pack is `APPROVED` and user has export permission
  - API/SQL/ETL buttons shown only when corresponding checks exist in pack content
- Added unit tests:
  - CSV escaping edge cases
  - Scenarios/Test cases CSV header + row generation

### Async Export v1 (Export Jobs + History)
- Prisma schema extended with:
  - `ExportStatus` enum (`QUEUED`, `PROCESSING`, `SUCCEEDED`, `FAILED`)
  - `Export` model for async export history and temporary CSV payload storage (`content_text`)
- `Job` model generalized for non-generation jobs:
  - `input_requirement_snapshot_id` is now nullable
  - `metadata_json` added for flexible job inputs (used by export jobs for `export_id`/`pack_id`/`kind`)
- Inngest export workflow added:
  - Event: `pack/export.requested`
  - Function: `src/inngest/functions/exportPack.ts`
  - Flow: QUEUED -> PROCESSING -> SUCCEEDED/FAILED for both `Job` and `Export`
- Pack viewer now supports async export requests:
  - "Request ... CSV" actions create `Export` + `Job` rows and dispatch Inngest event
  - Dispatch failures mark both `Job` and `Export` as `FAILED` with safe truncated errors
- Export history UI added to `/dashboard/packs/[packId]`:
  - Shows `created_at`, `kind`, `status`, `file_name`, `completed_at`, and failure snippet
  - Auto-refreshes while latest export is `QUEUED`/`PROCESSING`
- Download route added:
  - `GET /api/exports/[exportId]/download`
  - Enforces auth + workspace scoping + `export:download`
  - Allows only `SUCCEEDED` exports with stored `content_text`
- Audit events added for async exports:
  - `pack.export_requested`
  - `pack.export_job_succeeded`
  - `pack.export_job_failed`
  - `pack.exported`

### Workspace Audit Log UI (Epic 4 / Task 4.3)
- Added workspace-scoped audit query helper:
  - `server/auditRepo.ts` -> `listAuditEvents(workspaceId, filters)`
  - Supported exact-match filters:
    - `action`
    - `entityType`
    - `entityId`
    - `actorClerkUserId`
    - `limit` (default 50, max 200)
  - Returns safe fields only:
    - `id`, `created_at`, `actor_clerk_user_id`, `action`, `entity_type`, `entity_id`, `metadata_json`
- Added RBAC permission:
  - `audit:view` in authz permission map
  - Allowed roles: `OWNER`, `ADMIN`, `REVIEWER`
  - `EDITOR` is blocked from audit page access and redirected to `/forbidden`
- Added page:
  - `/dashboard/audit` (server-rendered, dynamic/fresh)
  - GET filter form + newest-first table view
  - Metadata displayed as compact truncated JSON preview (safe output)
  - Empty-state message for no rows
- Added navigation and convenience links:
  - App shell nav now shows `Audit Log` for `audit:view` roles
  - Pack viewer includes `View Pack Audit` deep link:
    - `/dashboard/audit?entityType=Pack&entityId=<packId>`

### MVP Polish + Hardening Pass (v1)
- Standardized user-facing feedback across status-driven pages:
  - Added shared alert components: `SuccessAlert`, `ErrorAlert`, `InfoAlert`
  - Applied consistent banners on requirement detail, pack viewer, and pack review pages
- Improved stale-status consistency for status-heavy pages:
  - Added explicit comments on `dynamic = "force-dynamic"` usage for:
    - requirement detail jobs
    - pack viewer export history
    - pack review state transitions
- Added safer pending/disabled action states to reduce double submits:
  - Generate Draft Pack button now shows `Generating...`
  - Export request buttons now show `Requesting...`
  - Pack review Approve/Reject now show pending labels (`Approving...`, `Rejecting...`)
- Nav/discoverability cleanup:
  - Main nav now focuses on MVP links (`Dashboard`, `Requirements`, `Audit Log`)
  - Demo-only `Reviewer Only` link removed from main nav (route still exists)
  - `Admin Area` nav label changed to `RBAC Demo`
- Error surfacing safety improvements:
  - Failed generation/export messages remain visible in UI
  - Error strings are truncated in UI to avoid layout breakage and noisy output
  - No stack traces are exposed to users
- Added lightweight dashboard loading fallback:
  - `app/dashboard/loading.tsx`
- Added concise end-to-end MVP smoke checklist to README for demos

### Phase 0 / Workstream 1 (Health + Env Validation + CI)
- Added strict environment validation with Zod:
  - `server/env.ts` as single source of truth for required server env vars
  - `getServerEnv()` validates once and caches
  - Friendly `EnvValidationError` lists missing/invalid variable names without exposing secrets
- Added local env verification command:
  - `npm run check-env` (`scripts/check-env.ts`)
- Added public health endpoint:
  - `GET /api/health` at `app/api/health/route.ts`
  - Includes safe checks for `db`, `env`, `inngest`, and `clerk`
  - Returns:
    - `200` + `status: "ok"` when essential checks pass
    - `503` + `status: "degraded"` when env/db checks fail
  - Includes `timestamp`, `version`, and `commit_sha` metadata
- Updated Clerk middleware public routes:
  - Added `/api/health(.*)` to public route matcher
- Added CI workflow:
  - `.github/workflows/ci.yml` for push + pull_request
  - Uses Node 20 and local Postgres service container
  - Runs:
    1. `npm ci`
    2. `npm run check-env`
    3. `npm run db:migrate:ci` (`prisma migrate deploy`)
    4. `npm test`
    5. `npm run build`
    6. `npm run lint --if-present`
- Added tests for hardening:
  - `server/env.test.ts` for readable env validation failures
  - `server/health.test.ts` for health status behavior (`200` vs `503`)
- Docs updated:
  - README now includes Health Endpoint and CI sections
  - Public routes list includes `/api/health`
  - MVP smoke checklist includes a health check step

### Phase 0 / Workstream 2 (Rate Limiting + Idempotency + Structured Logging)
- Added request/correlation id propagation:
  - `proxy.ts` now preserves inbound `x-request-id` or generates one via `randomUUID()`
  - Request id is forwarded to downstream handlers and echoed in response headers
  - Server helper added: `server/requestId.ts` (`resolveRequestId`, `getRequestIdFromHeaders`)
- Added structured logging + monitoring hook:
  - `server/log.ts` provides JSON logs with consistent fields:
    - `timestamp`, `level`, `msg`, `request_id`, optional workspace/actor/entity/action metadata
  - `server/monitor.ts` adds `captureException` / `captureMessage` as a lightweight vendor-neutral hook
  - WS#2-touched actions/routes now emit structured logs (no raw stack traces shown to users)
- Added rate-limit core module (`server/rateLimit/*`):
  - `RateLimitStore` interface + `MemoryRateLimitStore` implementation for local/dev
  - `rateLimit(...)` helper and typed `RateLimitError` (`429`, retry-after seconds)
  - Env-aware store selection in `server/env.ts`:
    - `RATE_LIMIT_STORE=memory` (default)
    - Redis config keys validated when `RATE_LIMIT_STORE=redis` (future swap path)
- Enforced idempotency + rate limits on critical actions:
  - Pack generation trigger (`server/pack-actions.ts`)
    - Dedupes when active generation job exists (`QUEUED`/`RUNNING`)
    - Rate limit: `3/60s` per `workspace + actor + requirement`
  - Async export request trigger (`server/export-actions.ts`)
    - Dedupes when active export exists for same `pack + kind` (`QUEUED`/`PROCESSING`)
    - Rate limit: `10/60s` per `workspace + actor + pack + kind`
  - Requirement write mutations (`server/requirements.ts`)
    - Rate limit: `30/60s` per `workspace + actor` for create/update/archive paths
  - CSV download endpoints:
    - `GET /api/exports/[exportId]/download`
    - `GET /api/packs/[packId]/export`
    - Rate limit: `60/60s` per `workspace + actor`
- Improved failure surfacing (safe + traceable):
  - Added `server/errors.ts` with `toPublicError(err)` -> stable public error shape with `request_id`
  - Generation/export dispatch failures continue to persist safe errors (`Job.error` / `Export.error`)
  - UI banners now include dedupe/rate-limit feedback and request id context for debugging
- Added WS#2 tests:
  - request id helper behavior
  - memory rate limiter window behavior
  - idempotency helper behavior for generation/export active statuses
  - env validation for Redis-required vars when `RATE_LIMIT_STORE=redis`

Why this was done:
- Addresses core MVP operational risks before scale/demo load:
  - duplicate job creation from repeated clicks
  - abuse-prone write/download endpoints without server-side throttling
  - low-debuggability failures without request correlation id and structured logs

### Phase 0 / Workstream 3 (Staging + Backup/Restore Readiness)
- Added `APP_ENV` to environment validation and staging local conventions:
  - Allowed values: `local`, `staging`, `prod`
  - Default: `local`
  - `.env.staging.example` added; `.env.staging.local` reserved for private staging runtime variables
- Added staging developer scripts:
  - `staging:dev`
  - `staging:check-env`
  - `staging:db:migrate`
  - `staging:db:seed`
  - `staging:db:verify`
- Added database operations tooling:
  - `db:backup` (`scripts/db-backup.sh`)
  - `db:restore` (`scripts/db-restore.sh`)
  - `db:verify` (`scripts/db-verify.ts`)
- Added demo seed path: `prisma/seed.ts` and scripts `db:seed`, `staging:db:seed`
- Added restore runbook: `docs/runbooks/db-backup-restore.md`
- Added `backups/` to `.gitignore`
- Updated docs to include Environment and Backup/Restore sections, and staging references.

Why this was done:
- Make local vs staging environments explicit and repeatable.
- Provide a clear backup/restore runbook before production/staging demos.

### Phase 1 / Workstream 2A (Requirement Artifacts)
- Added `RequirementArtifact` storage for grounding inputs attached to `RequirementSnapshot`.
- Added UI on the requirement detail page to add/edit/delete pasted artifacts for:
  - `OPENAPI`
  - `PRISMA_SCHEMA`
- Artifacts store normalized text plus `content_hash`, and CRUD emits audit events:
  - `requirement_artifact.created`
  - `requirement_artifact.updated`
  - `requirement_artifact.deleted`
- No parsing or validation yet. `metadata_json` is reserved for the next workstream.
- Next: Workstream 2B will parse OpenAPI/Prisma artifacts and enforce grounding gates during AI generation.

### Phase 1 / Workstream 2A.1 (Artifact Test Harness Stabilization)
- Fixed red tests caused by importing Next/server-only runtime boundaries at module load:
  - AI pack generation now lazy-loads the default OpenAI structured-output runner and critic path.
  - Requirement Artifact tests now target pure helpers/core logic instead of pulling in auth/navigation-only wrappers.
- Added focused automated artifact coverage for:
  - create/update/delete flows
  - safe audit metadata on create/update/delete
  - snapshot linkage semantics (artifacts stay on their original snapshot; no inheritance to newer snapshots)
  - latest-snapshot artifact panel view-model shaping and edit/delete permission flags
- Workstream 2A is sign-off ready only when `npm test` is green.

### Phase 1 / Workstream 2B (Artifact Parsing + Validation)
- Added parser-backed artifact summaries for:
  - `OPENAPI` via YAML/JSON parsing plus OpenAPI validation
  - `PRISMA_SCHEMA` via `prisma-ast`
- Valid and invalid parse summaries are stored in `RequirementArtifact.metadata_json`.
- The artifacts panel now shows `Valid` / `Invalid` / `Unknown` state plus concise summary counts and a short error preview for invalid artifacts.
- Parsing runs during artifact create/update so all server-action and direct repo writes stay consistent.
- Next: Workstream 2C will use these stored summaries as grounding gates during AI pack generation.

### Phase 1 / Workstream 2C.1 (OpenAPI Grounding Gate)
- AI pack generation now looks up the latest valid `OPENAPI` artifact for the target requirement snapshot and passes only a compact grounded operation list into the LLM prompt.
- Generated `checks.api` entries are validated server-side against grounded `{ method, path }` operations after deterministic pack validation.
- Grounding mismatches trigger the existing single repair attempt; if mismatches remain after repair, generation fails safely and no misleading grounded pack is persisted.
- Grounding results are stored in `Job.metadata_json.ai.grounding.openapi`, including `status`, `artifact_id`, operation counts, grounded API-check counts, and safe mismatch details.
- If no valid `OPENAPI` artifact exists for the snapshot, generation continues unchanged and records grounding as `skipped`.
- Next phase: Prisma grounding for SQL checks.

### UX Hardening Pass
- Added shared UI helpers for current and upcoming UX polish work:
  - persisted expand/collapse previews
  - copy-to-clipboard button
  - pure presentation helpers for generation jobs, artifact grounding readiness, and pack/review summaries
- Added tests covering:
  - generation job metadata parsing and failure classification
  - artifact grounding readiness summaries
  - pack overview / review highlight shaping
- Build log now lives at `docs/build-log.md`.
- UI summary now lives at `docs/ui-ux-summary.md`.
- Requirement detail page UX is now improved with:
  - sticky header actions
  - latest-snapshot grounding readiness chips and notes
  - an explicit in-progress generation banner
  - richer generation job cards with retry, copy, failure classification, and inline AI/grounding metadata
- Pack viewer and review UX are now improved with:
  - sticky action headers
  - copy affordances for ids and hashes
  - compact pack summary cards
  - readable review highlights before raw JSON editing
  - persisted expansion state for the main snapshot/json surfaces
- Production validation is green after fixing two existing type-boundary issues in the OpenAI client wrapper and artifact parser.

## How to Run (Local)
- Set `.env.local` with Clerk keys + `DATABASE_URL` (Neon Direct URL)
- Apply migrations: `npm run db:migrate`
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm run test`

## Next Step (Single Focus)
Phase 1 / Workstream 2C.2: Add Prisma grounding for SQL checks during AI pack generation.

## Reliability Hardening - 2026-03-12
- Added a bounded OpenAI structured-output request timeout so pack generation jobs fail cleanly instead of hanging in `RUNNING`.
- Timeout handling now emits a safe retry message and is classified separately in latest-run failure UX as `AI provider timeout`.
- Reduced AI prompt size for critic and repair loops by sending compact pack summaries instead of full pack JSON.
- Split OpenAI timeout budgets by stage: longer for pack generation, shorter for critic review.
- Replaced reliance on the SDK timeout alone with an explicit abort-backed timeout wrapper so hung provider calls cannot leave jobs running indefinitely.

## Phase 1 / Reliability Stabilization
- Added workflow-level observability for `generate_pack` OpenAI jobs without changing the DB schema. Running jobs now persist `metadata_json.runtime` with stage, attempt, deadline, and generation/critic model names.
- Added a hard 12-minute workflow deadline for AI pack generation. OpenAI calls now consume the remaining workflow budget instead of using only per-request timeouts.
- Added `OPENAI_GENERATION_MODEL` so generation/repair can use a stronger model while the critic remains on `OPENAI_MODEL`.
- Latest-run summaries now understand running runtime metadata and show stage-aware progress plus a dedicated workflow-deadline failure classification.
- Existing OpenAPI and Prisma grounding behavior remains intact; this pass focused on reliability, deadline enforcement, and observability.

### Reliability Stabilization - generate_pack retry control
- `generate_pack` is now non-retryable at the Inngest function level (`retries: 0`) because deterministic AI-generation failures were stretching a single job across many minutes and overwriting useful failure context.
- Added failure-metadata finalization that preserves the last real runtime stage (for example `initial_generation`, `repair_critic`) instead of falling back to a fresh `load_context` runtime block at failure time.
- Added targeted tests for failure-metadata preservation and non-retryable generation-failure classification.

## Reliability follow-up: preserved runtime stage on generate_pack failure
- Fixed failure metadata finalization to prefer the last persisted OpenAI runtime metadata already written to the `Job` row.
- This addresses Inngest replay/resume cases where in-memory stage tracking resets to `load_context` before the failure handler runs.
- `generate_pack` failures should now keep the last real runtime stage in `Job.metadata_json.runtime` instead of collapsing back to fallback `load_context` metadata.

## Reliability Instrumentation Pass - generate_pack stage evidence
- Added compact stage-evidence runtime metadata for `generate_pack` jobs without changing generation behavior or grounding rules.
- `Job.metadata_json.runtime` now records a stage history with enter/exit timestamps, durations, provider-call markers, timeout budgets, requirement size metrics, grounding input counts, pack API/SQL counts, semantic SQL counts, mismatch counts, and compact notes.
- Running/failing jobs now preserve `critic_entered`, `repair_entered`, `repair_critic_entered`, `last_provider_stage`, `final_outcome`, `final_failure_stage`, and `final_failure_message` so Prisma Studio alone can distinguish provider timeout vs workflow deadline vs grounding vs critic coverage failures.
- The worker now records `load_context` success with requirement/artifact sizing and records `finalize` success around pack persistence.
- Latest-run metadata parsing remains backward-compatible while understanding the richer runtime evidence shape.

## Phase 1 / Workstream 3A - Acceptance Criteria Coverage Planner
- Added a deterministic acceptance-criteria planner for `generate_pack` that extracts numbered items from the `Acceptance Criteria:` section, assigns stable `AC-xx` ids, and tags each criterion with expected coverage layers (`UI`, `API`, `SQL`, `AUDIT`, `SECURITY`, `SESSION`, `OTHER`).
- Added a deterministic acceptance-coverage map before critic review. Generated scenarios, test cases, and checks are expected to reference `AC-xx` ids via existing fields such as `tags`, and obviously uncovered ids trigger one targeted repair attempt before final critic rejection.
- The AI generation and repair prompts now include a compact Acceptance Criteria Coverage Plan so generation explicitly plans against each criterion instead of relying only on broad critic feedback.
- Critic input is now AC-aware and uses the deterministic coverage map as a baseline. Critic failures record explicit uncovered `AC-xx` ids instead of only broad natural-language gaps.
- Final OpenAI job metadata now stores compact coverage evidence under `metadata_json.ai.coverage_plan`, `metadata_json.ai.coverage_map`, and `metadata_json.ai.critic.coverage.uncovered`.
- Existing OpenAPI and Prisma grounding behavior remains unchanged.
- Next likely step: surface grounding and AC coverage proof in the review UI instead of keeping it DB-only.

## Phase 1 / Workstream 3B - Deterministic Coverage Closure
- Final critic evidence is now preserved more precisely. `metadata_json.ai.critic` stores the latest critic phase (`initial` or `repair`) plus explicit uncovered `AC-xx` ids when critic coverage still fails.
- Added a deterministic coverage-closure planner that turns uncovered `AC-xx` items into layer-aware repair obligations such as `add_ui_case`, `add_api_case_or_check`, `add_audit_or_logging_check`, and `add_session_case_or_check`.
- Repair prompts are now driven by uncovered-AC obligations instead of only broad critic prose, so repair is explicitly told which AC ids must be closed and which layer each obligation must satisfy.
- Added deterministic closure validation before the final critic. `metadata_json.ai.coverage_closure_validation` now records whether the repaired pack actually closed the previously uncovered AC ids in a layer-appropriate way.
- Added an early deterministic validation for malformed API checks so missing HTTP methods fail in validation before OpenAPI grounding.
- Next likely step: surface grounding and coverage proof in the UI instead of keeping it DB-only.

## Phase 1 / Workstream 3C - Deterministic Repair Hardening + Final Critic Evidence Preservation
- Added deterministic sanitization before validation for both initial and repaired AI candidates. Safe structural fixes such as swapped `source_refs` line ranges, API method casing normalization, and safe text trimming now happen before validation without fabricating missing business content.
- `metadata_json.ai.sanitization` now records compact initial/repair sanitization summaries so we can see whether validation passed only after deterministic cleanup.
- Final critic evidence preservation is hardened: `metadata_json.ai.critic` now remains the canonical latest critic result, and failed `repair_critic` runs keep explicit uncovered `AC-xx` ids plus reasons in job metadata.
- Added compensating-coverage validation for cases where Prisma grounding downgrades concrete SQL into semantic `NEEDS_MAPPING:` checks. Session, UI, API/security, and audit-heavy ACs now require stronger concrete coverage in other layers before the repaired pack can pass.
- Pack validation now fails malformed API checks earlier and more clearly when required fields such as `method`, `endpoint`, or valid `source_refs` are still missing after sanitization.
- Next likely step: surface sanitization, grounding, and coverage proof together in the review UI instead of keeping it DB-only.

## 2026-03-29 - Live generate_pack recovery follow-up
- Preserved final `metadata_json.ai` across the Inngest `generate-pack-content` step by serializing `AiPackGenerationError` metadata before crossing the step boundary and restoring it afterward. Failed jobs can now keep critic/grounding/sanitization evidence instead of collapsing to runtime-only metadata.
- Added deterministic OpenAPI-based API method recovery before validation. If an API check is missing `method` but its `endpoint` uniquely matches one grounded OpenAPI operation, the method is recovered safely from grounding instead of forcing an avoidable repair.
- Expanded deterministic sanitization so repaired candidates now normalize drifting `source_ref.snapshot_id` values to the current requirement snapshot and reassign duplicate or invalid ids in `clarifying_questions`, `test_cases`, and check collections.
- Hardened repair prompt guidance so every repair pass now explicitly forbids duplicate ids, requires current-snapshot source refs, and forbids partial API checks without both method and endpoint.
- Real end-to-end verification succeeded on snapshot `cmn6vk6cv00ylup16qyjx6sy7`: job `cmnc5awro0001upha7bu2ykkt` finished `SUCCEEDED` and produced pack `cmnc5i0j80001upicx2s99pxb` after one repair pass.
- Runtime evidence from that successful live job showed the system now gets through initial validation, grounding, critic, repair generation, repair validation, repair grounding, and final critic with full `metadata_json.ai` preserved.
- 2026-03-30 cleanup pass: removed lint-backed unused code and local export artifacts, replaced effect-driven mount/localStorage state with cleaner initialization patterns, and confirmed `npm run lint`, `npm test`, and `npm run build` all pass before packaging the branch.

cat <<'EOF' >> /Users/anweshsingh/Downloads/TraceCase/docs/build-log.md

## 2026-03-30 - Repo cleanup pass

- Scope:
  - Removed lint-backed unused code and warnings left around the recent reliability work.
  - Cleaned client-only mounted/localStorage components to avoid effect-driven state warnings.
  - Excluded generated local export CSVs under `Test case results/` from version control.
- Commands:
  - `npm run lint`
  - `npm test`
  - `npm run build`
- Result:
  - `npm run lint`: `passed`
  - `npm test`: `147 passed`, `0 failed`
  - `npm run build`: `passed`
- 2026-03-30 success-runtime follow-up: fixed the success-path runtime handoff in `generate_pack` so finalized jobs preserve the richer runtime stage history returned by generation instead of collapsing back to a stale worker-side `load_context` runtime. Added focused tests for success-runtime selection.

cat <<'EOF' >> /Users/anweshsingh/Downloads/TraceCase/docs/build-log.md

## 2026-03-30 - Success-path runtime evidence preservation

- Scope:
  - Fixed the `generate_pack` success path to prefer the richer runtime metadata returned by `generateAiPackWithCritic` when entering/finalizing the `finalize` stage.
  - Added a focused helper and tests so successful jobs keep full runtime stage history instead of collapsing to `load_context + finalize`.
- Commands:
  - `npx tsx --test server/packs/generatePackSuccess.test.ts server/packs/generatePackFailure.test.ts server/packs/generationRunContext.test.ts`
  - `npm run lint`
  - `npm test`
  - `npm run build`
- Result:
  - Focused tests: `10 passed`, `0 failed`
  - `npm run lint`: `passed`
  - `npm test`: `149 passed`, `0 failed`
  - `npm run build`: `passed`
