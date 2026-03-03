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
- Public: `/`, `/sign-in`, `/sign-up`
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

## Build

```bash
npm run build
```

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

RBAC permission helpers + enforcement points.
