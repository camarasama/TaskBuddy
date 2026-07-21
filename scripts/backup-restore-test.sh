#!/usr/bin/env bash
#
# Prove the nightly backups are actually restorable. An untested backup is not a backup.
#
# Downloads the latest dump from the private R2 backups bucket, restores it into a THROWAWAY
# database, checks the restored data looks real, and drops the scratch DB again. Production is
# never written to — the only DB touched is $SCRATCH_DB, and the script refuses to run if that
# resolves to the live database name.
#
# Run as root (needs peer auth as the postgres OS user + the root-owned backup.env):
#   sudo env $(grep -v '^#' /opt/taskbuddy/backup.env | xargs) /opt/taskbuddy/app/scripts/backup-restore-test.sh
#
# Optional env (defaults shown):
#   DB_NAME=taskbuddy               # production DB, used only as a guard + for comparison
#   SCRATCH_DB=taskbuddy_restore_test
#   APP_DIR=/opt/taskbuddy/app
#   BACKUP_KEY=                     # specific backup to test; default = most recent
#   KEEP=0                          # 1 keeps the scratch DB for inspection
#   SKIP_DISK_CHECK=0               # 1 bypasses the free-space preflight (see below)
#
set -euo pipefail

DB_NAME="${DB_NAME:-taskbuddy}"
SCRATCH_DB="${SCRATCH_DB:-taskbuddy_restore_test}"
APP_DIR="${APP_DIR:-/opt/taskbuddy/app}"
KEEP="${KEEP:-0}"

# --- Guards: never let this touch production ------------------------------------------------
if [ "$SCRATCH_DB" = "$DB_NAME" ]; then
  echo "REFUSING: SCRATCH_DB ($SCRATCH_DB) is the production database." >&2
  exit 1
fi
case "$SCRATCH_DB" in
  *restore_test*) ;;
  *) echo "REFUSING: SCRATCH_DB ($SCRATCH_DB) must contain 'restore_test'." >&2; exit 1 ;;
esac

psql_scratch() { runuser -u postgres -- psql -tAX -d "$SCRATCH_DB" -c "$1"; }

TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
  if [ "$KEEP" != "1" ]; then
    runuser -u postgres -- dropdb --if-exists "$SCRATCH_DB" 2>/dev/null || true
  fi
}
trap cleanup EXIT

DUMP="$TMP/backup.sql.gz"

# --- 0. Preflight: is there room to restore a second copy of the database? -------------------
# The scratch DB is a full copy, so this briefly doubles the footprint. Postgres is shared with
# GNFS on this box — filling the data volume would take down both apps, so refuse rather than
# risk it. Override with SKIP_DISK_CHECK=1 if you know better.
human_mb() { echo "$(( $1 / 1024 ))MB"; }

DATA_DIR=$(runuser -u postgres -- psql -tAX -c "SHOW data_directory;")
DB_KB=$(runuser -u postgres -- psql -tAX -c "SELECT pg_database_size('$DB_NAME') / 1024;")
FREE_KB=$(df -Pk "$DATA_DIR" | awk 'NR==2 {print $4}')
NEED_KB=$(( DB_KB * 13 / 10 ))   # restored copy + 30% headroom for WAL and index build

echo "==> preflight: database $(human_mb "$DB_KB"), free on $DATA_DIR $(human_mb "$FREE_KB"), need ~$(human_mb "$NEED_KB")"
if [ "${SKIP_DISK_CHECK:-0}" != "1" ] && [ "$FREE_KB" -lt "$NEED_KB" ]; then
  echo "REFUSING: not enough free space to restore a second copy." >&2
  echo "  Postgres shares this volume with GNFS; filling it would take down both apps." >&2
  echo "  Free up space, or re-run with SKIP_DISK_CHECK=1 if you are certain." >&2
  exit 1
fi

# The compressed dump also lands in $TMP, which may be a different filesystem.
TMP_FREE_KB=$(df -Pk "$TMP" | awk 'NR==2 {print $4}')
if [ "$TMP_FREE_KB" -lt "$DB_KB" ]; then
  echo "WARNING: only $(human_mb "$TMP_FREE_KB") free on $TMP — the dump may not fit." >&2
fi

# --- 1. Fetch the latest backup from R2 -----------------------------------------------------
echo "==> downloading latest backup from R2"
cd "$APP_DIR"
DEST_FILE="$DUMP" node "$APP_DIR/scripts/backup-r2-download.mjs"

echo "==> verifying gzip integrity"
gunzip -t "$DUMP"

# --- 2. Restore into a throwaway database ---------------------------------------------------
echo "==> restoring into scratch database '$SCRATCH_DB'"
runuser -u postgres -- dropdb --if-exists "$SCRATCH_DB"
runuser -u postgres -- createdb "$SCRATCH_DB"
gunzip -c "$DUMP" | runuser -u postgres -- psql -q --set ON_ERROR_STOP=on -d "$SCRATCH_DB" >/dev/null

# --- 3. Check the restored data actually looks like TaskBuddy -------------------------------
echo "==> verifying restored contents"
FAILED=0
check() { # name, actual, expectation-description, test-expression
  if eval "$4"; then
    printf '  ok    %-34s %s\n' "$1" "$2"
  else
    printf '  FAIL  %-34s %s (expected %s)\n' "$1" "$2" "$3"
    FAILED=1
  fi
}

TABLES=$(psql_scratch "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
check "public tables" "$TABLES" ">= 10" '[ "$TABLES" -ge 10 ]'

USERS=$(psql_scratch "SELECT count(*) FROM users;")
check "users rows" "$USERS" "> 0" '[ "$USERS" -gt 0 ]'

FAMILIES=$(psql_scratch "SELECT count(*) FROM families;")
check "families rows" "$FAMILIES" "> 0" '[ "$FAMILIES" -gt 0 ]'

# Password hashes must survive the round-trip, or restored accounts cannot log in.
HASHES=$(psql_scratch "SELECT count(*) FROM users WHERE password_hash LIKE '\$2%';")
check "bcrypt password hashes" "$HASHES" "> 0" '[ "$HASHES" -gt 0 ]'

# Schema currency: the backup should carry the latest migration, not a stale schema.
LOCKOUT_COL=$(psql_scratch "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='failed_login_attempts';")
check "latest migration present" "$LOCKOUT_COL" "= 1" '[ "$LOCKOUT_COL" = "1" ]'

MIGRATIONS=$(psql_scratch "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
check "applied migrations" "$MIGRATIONS" "> 0" '[ "$MIGRATIONS" -gt 0 ]'

# Compare against production so a truncated dump is caught rather than passing on ">0".
# Comparing raw totals would drift as real users sign up after the backup was taken, so compare
# against production *as of the backup's own timestamp* — that number should not move.
BACKUP_TS=""
if [ -f "$DUMP.key" ]; then
  # Keys look like taskbuddy-20260721T023000Z.sql.gz
  RAW_TS=$(sed -n 's/^taskbuddy-\([0-9]\{8\}T[0-9]\{6\}Z\)\.sql\.gz$/\1/p' "$DUMP.key")
  if [ -n "$RAW_TS" ]; then
    BACKUP_TS="${RAW_TS:0:4}-${RAW_TS:4:2}-${RAW_TS:6:2} ${RAW_TS:9:2}:${RAW_TS:11:2}:${RAW_TS:13:2}+00"
  fi
fi

if [ -n "$BACKUP_TS" ]; then
  PROD_AT_BACKUP=$(runuser -u postgres -- psql -tAX -d "$DB_NAME" \
    -c "SELECT count(*) FROM users WHERE created_at <= timestamptz '$BACKUP_TS';" 2>/dev/null || echo "?")
  if [ "$PROD_AT_BACKUP" != "?" ]; then
    # Exact match expected. Rows hard-deleted since the backup would lower the live side, so
    # allow the live count to be *below* the restored count, but never above — that direction
    # means the dump is missing rows it should have had.
    check "users vs prod at backup time" "$USERS restored / $PROD_AT_BACKUP live" \
      "restored >= live-at-backup" '[ "$USERS" -ge "$PROD_AT_BACKUP" ]'
    if [ "$USERS" -gt "$PROD_AT_BACKUP" ]; then
      echo "        note: $(( USERS - PROD_AT_BACKUP )) row(s) hard-deleted since the backup"
    fi
  fi
else
  echo "  skip  users vs prod                   (could not parse backup timestamp)"
fi

PROD_NOW=$(runuser -u postgres -- psql -tAX -d "$DB_NAME" -c "SELECT count(*) FROM users;" 2>/dev/null || echo "?")
[ "$PROD_NOW" != "?" ] && echo "        (production now: $PROD_NOW users; backup: $USERS)"

echo
if [ "$FAILED" = "0" ]; then
  echo "RESTORE TEST PASSED — the latest backup is recoverable."
else
  echo "RESTORE TEST FAILED — see the FAIL lines above." >&2
fi

[ "$KEEP" = "1" ] && echo "(scratch DB '$SCRATCH_DB' kept for inspection; drop with: sudo runuser -u postgres -- dropdb $SCRATCH_DB)"

exit "$FAILED"
