#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL before running db backup.}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not found in PATH."
  exit 1
fi

if ! command -v gzip >/dev/null 2>&1; then
  echo "gzip is required but not found in PATH."
  exit 1
fi

APP_ENV_VALUE="${APP_ENV:-local}"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
mkdir -p backups
BACKUP_FILE="backups/tracecase_${APP_ENV_VALUE}_${TIMESTAMP}.sql.gz"


echo "Creating compressed database backup to: ${BACKUP_FILE}"
PGSSLMODE=require pg_dump "${DATABASE_URL}" --no-owner --no-privileges |
  gzip -c >"${BACKUP_FILE}"

FILE_SIZE_BYTES="$(wc -c <"${BACKUP_FILE}")"
FILE_SIZE_MB="$(du -h "${BACKUP_FILE}" | awk '{print $1}') (${FILE_SIZE_BYTES} bytes)"

echo "Backup complete."
echo "  file: ${BACKUP_FILE}"
echo "  size: ${FILE_SIZE_MB}"
