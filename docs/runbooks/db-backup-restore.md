# DB Backup & Restore Runbook

This runbook documents a repeatable backup/restore path for TraceCase environments.

## Preconditions

- `pg_dump` and `psql` are installed and available on PATH.
- `DATABASE_URL` is set for the target environment.
- You have write access to the target database.
- You understand this is a destructive operation for restore if `CONFIRM_DROP=1`.

## Backup Procedure

1. Ensure your environment points at the intended DB (for example set `DATABASE_URL` in `.env.local` or `.env.staging.local`).
2. Run:

```bash
npm run db:backup
```

This creates:

```text
./backups/tracecase_<app_env>_<YYYYMMDD_HHMMSS>.sql.gz
```

The command uses `pg_dump` with `PGSSLMODE=require` and writes a compressed SQL file.

## Restore Procedure

### Verify backup file

```bash
ls -lh backups/
```

### Restore into target DB

```bash
export BACKUP_FILE=./backups/your_backup_file.sql.gz
export DATABASE_URL=<target database url>

# optional safety gate: drop and recreate schema first
export CONFIRM_DROP=1

npm run db:restore
```

If `CONFIRM_DROP=1` is set, restore will:

1. Drop `public` schema
2. Recreate `public` schema
3. Restore the backup

If `CONFIRM_DROP` is not set, restore attempts to load without schema reset.

### Safety notes

- Do **not** run restore against production without an explicit maintenance window and backup.
- Confirm target `DATABASE_URL` points to the intended database before setting `CONFIRM_DROP=1`.
- Prefer restoring into staging first.

## Verification

After restore, verify DB health and row counts:

```bash
npm run db:verify
curl http://localhost:3000/api/health
```

Optional manual checks:

```sql
SELECT COUNT(*) FROM "Workspace";
SELECT COUNT(*) FROM "Requirement";
SELECT COUNT(*) FROM "RequirementSnapshot";
```

## Restore Drill Checklist (Template)

- Date: `YYYY-MM-DD`
- Backup file used:
- Target DB URL reviewed and confirmed (sanitized):
- `CONFIRM_DROP` set:
- Restore completed without errors:
- `npm run db:verify` output checked:
- `/api/health` status ok:
- Additional notes:
