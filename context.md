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
- Clerk integrated with protected routing via Clerk middleware (public routes: `/`, `/sign-in(.*)`, `/sign-up(.*)`; everything else protected)
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

## How to Run (Local)
- Set `.env.local` with Clerk keys + `DATABASE_URL` (Neon Direct URL)
- Apply migrations: `npm run db:migrate`
- Dev: `npm run dev`
- Build: `npm run build`

## Next Step (Single Focus)
Epic 1: Requirements intake + traceability
1) Requirements CRUD (scoped to workspace)
2) RequirementSnapshot versioning (immutable source snapshots with version increments + hash)