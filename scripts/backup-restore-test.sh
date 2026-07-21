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
PROD_USERS=$(runuser -u postgres -- psql -tAX -d "$DB_NAME" -c "SELECT count(*) FROM users;" 2>/dev/null || echo "?")
if [ "$PROD_USERS" != "?" ]; then
  DRIFT=$(( PROD_USERS - USERS ))
  [ "$DRIFT" -lt 0 ] && DRIFT=$(( -DRIFT ))
  check "users vs prod ($PROD_USERS live)" "$USERS restored" "within 5" '[ "$DRIFT" -le 5 ]'
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "RESTORE TEST PASSED — the latest backup is recoverable."
else
  echo "RESTORE TEST FAILED — see the FAIL lines above." >&2
fi

[ "$KEEP" = "1" ] && echo "(scratch DB '$SCRATCH_DB' kept for inspection; drop with: sudo runuser -u postgres -- dropdb $SCRATCH_DB)"

exit "$FAILED"
