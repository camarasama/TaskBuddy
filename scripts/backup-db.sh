#!/usr/bin/env bash
#
# TaskBuddy Postgres backup -> Cloudflare R2 (private bucket).
#
# Dumps the database, gzips it, uploads to R2, and prunes backups older than
# RETENTION_DAYS. Designed to run as root via the taskbuddy-backup systemd timer,
# which loads credentials from /opt/taskbuddy/backup.env (never committed).
#
# Required env (see /opt/taskbuddy/backup.env):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# Optional env (defaults shown):
#   R2_BACKUP_BUCKET=taskbuddy-backups  RETENTION_DAYS=14
#   DB_NAME=taskbuddy  APP_DIR=/opt/taskbuddy/app
#
set -euo pipefail

DB_NAME="${DB_NAME:-taskbuddy}"
APP_DIR="${APP_DIR:-/opt/taskbuddy/app}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="taskbuddy-${TS}.sql.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILE="$TMP/$KEY"

# 1. Dump via peer auth as the postgres OS user (no password needed) + gzip.
#    --no-owner/--no-privileges keeps the dump restorable under any role.
runuser -u postgres -- pg_dump --no-owner --no-privileges "$DB_NAME" | gzip -9 > "$FILE"

# 2. Upload to R2 + prune old backups, using the AWS SDK already in the app.
cd "$APP_DIR"
BACKUP_FILE="$FILE" BACKUP_KEY="$KEY" node "$APP_DIR/scripts/backup-r2-upload.mjs"

echo "backup complete: $KEY"
