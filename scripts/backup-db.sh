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

# Prefer the side-by-side Node 22. systemd runs this as root, whose PATH resolves /usr/bin/node —
# v20, shared with GNFS and not ours to upgrade. The AWS SDK requires node >=22 for releases after
# January 2027. An explicit NODE_BIN is honoured strictly (a bad one is an error, not a silent
# fallback); otherwise prefer 22, then fall back to PATH if it is absent (e.g. after a rollback).
if [ -n "${NODE_BIN:-}" ]; then
  [ -x "$NODE_BIN" ] || { echo "NODE_BIN=$NODE_BIN is not executable" >&2; exit 1; }
else
  NODE_BIN=/opt/nodejs/22/bin/node
  [ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
  [ -n "$NODE_BIN" ] || { echo "No node found (tried /opt/nodejs/22/bin/node and PATH)" >&2; exit 1; }
fi

# Fail with a readable message rather than a bare non-zero exit. `runuser` in particular lives in
# /usr/sbin, which root's default PATH includes but a hand-written Environment=PATH easily drops —
# that exact mistake broke this unit once, and the journal said only "control process exited".
MISSING=""
for c in runuser gzip mktemp date; do
  command -v "$c" >/dev/null 2>&1 || MISSING="$MISSING $c"
done
if [ -n "$MISSING" ]; then
  echo "Required command(s) not found on PATH:$MISSING" >&2
  echo "PATH=$PATH" >&2
  exit 1
fi

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
BACKUP_FILE="$FILE" BACKUP_KEY="$KEY" "$NODE_BIN" "$APP_DIR/scripts/backup-r2-upload.mjs"

echo "backup complete: $KEY"
