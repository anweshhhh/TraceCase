#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL before running db restore.}"
: "${BACKUP_FILE:?Set BACKUP_FILE path to run restore.}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not found in PATH."
  exit 1
fi

if ! command -v gzip >/dev/null 2>&1; then
  echo "gzip is required but not found in PATH."
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

if [ "${CONFIRM_DROP:-}" != "1" ]; then
  echo "CONFIRM_DROP is not set to 1; restore will run without schema reset."
else
  echo "CONFIRM_DROP=1 detected: dropping and recreating public schema before restore."
  PGSSLMODE=require psql "${DATABASE_URL}" <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL
fi

echo "Restoring backup from: ${BACKUP_FILE}"
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gzip -dc "${BACKUP_FILE}" | PGSSLMODE=require psql "${DATABASE_URL}"
else
  PGSSLMODE=require psql "${DATABASE_URL}" <"${BACKUP_FILE}"
fi

echo "Restore complete."
echo "Verification hint: run npm run db:verify and curl http://localhost:3000/api/health."
