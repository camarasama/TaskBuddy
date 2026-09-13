#!/usr/bin/env bash
#
# Full-server backup of the OVH VPS, taken ahead of a provider migration.
#
# This is NOT the nightly app backup (that is scripts/backup-db.sh, TaskBuddy DB only, to R2).
# This one captures EVERYTHING needed to rebuild the whole box somewhere else: every database,
# every site, every service unit, the TLS material, and the secrets. It is a one-shot tool.
#
# Run it as root ON THE VPS:
#
#   sudo ENCRYPT_PASSPHRASE='<a long passphrase you store elsewhere>' \
#     bash /opt/taskbuddy/app/scripts/vps-full-backup.sh
#
# Then copy the result down from your laptop:
#
#   scp gnfs-vps:/var/tmp/vps-migration-<stamp>/* ~/vps-migration/
#
# WHAT THIS BUNDLE CONTAINS: database dumps, TLS private keys, and .env files with SMTP, R2 and
# JWT secrets. Treat the output like a password vault. Set ENCRYPT_PASSPHRASE and it is wrapped
# in gpg symmetric AES-256 before it ever leaves the machine; leave it unset and the script still
# runs, but warns, because an unencrypted copy on a laptop or in cloud storage is a breach waiting
# to happen.
#
# Optional env (defaults shown):
#   OUT_BASE=/var/tmp            # where the bundle is written (must be disk-backed, NOT /tmp)
#   ENCRYPT_PASSPHRASE=          # if set, gpg-encrypts the archives
#   WITH_NODE_MODULES=0          # 1 also archives node_modules (usually pointless, always huge)
#   SKIP_DISK_CHECK=0            # 1 bypasses the free-space preflight
#
# /tmp on this box is tmpfs (RAM) and shared with the other apps, so the default lands in
# /var/tmp deliberately. Do not "fix" that back to /tmp.
#
set -euo pipefail

OUT_BASE="${OUT_BASE:-/var/tmp}"
WITH_NODE_MODULES="${WITH_NODE_MODULES:-0}"
SKIP_DISK_CHECK="${SKIP_DISK_CHECK:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_BASE/vps-migration-$TS"

log()  { printf '\n=== %s\n' "$*"; }
warn() { printf '\n!!! %s\n' "$*" >&2; }
die()  { printf '\nFATAL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "must run as root (TLS keys, backup.env and peer auth as postgres all need it)"

MISSING=""
for c in tar gzip runuser pg_dump pg_dumpall psql sha256sum dpkg systemctl nginx; do
  command -v "$c" >/dev/null 2>&1 || MISSING="$MISSING $c"
done
[ -z "$MISSING" ] || die "missing command(s):$MISSING (PATH=$PATH)"

if [ -n "${ENCRYPT_PASSPHRASE:-}" ]; then
  command -v gpg >/dev/null 2>&1 || die "ENCRYPT_PASSPHRASE is set but gpg is not installed (apt-get install -y gnupg)"
else
  warn "ENCRYPT_PASSPHRASE is not set. The bundle will contain TLS private keys, database"
  warn "dumps and .env secrets IN THE CLEAR. Re-run with ENCRYPT_PASSPHRASE set unless you"
  warn "have another plan for protecting it. Continuing in 10 seconds."
  sleep 10
fi

# The bundle is roughly the size of the data it copies. Refuse to start if the disk cannot
# plausibly hold it, because a tar that dies at 99% leaves a file that looks almost right.
if [ "$SKIP_DISK_CHECK" != "1" ]; then
  AVAIL_MB=$(df -Pm "$OUT_BASE" | awk 'NR==2 {print $4}')
  NEED_MB=$(du -sm --exclude=node_modules /var/www /opt/taskbuddy/uploads /opt/ep-contact /home 2>/dev/null \
            | awk '{s+=$1} END {print int(s*1.5)+2048}')
  [ "$AVAIL_MB" -ge "$NEED_MB" ] \
    || die "only ${AVAIL_MB}MB free on $OUT_BASE, want ~${NEED_MB}MB. Free space or set SKIP_DISK_CHECK=1."
fi

mkdir -p "$OUT"
chmod 700 "$OUT"
log "writing bundle to $OUT"

# ---------------------------------------------------------------------------
# 1. Databases: globals (roles + passwords) first, then one custom-format dump each
# ---------------------------------------------------------------------------
#
# --globals-only carries the role definitions AND their md5/scram password hashes, so the new
# box authenticates the existing app roles with the existing DATABASE_URLs and nothing has to
# be re-issued. Restore it BEFORE the per-database dumps or every GRANT fails on a missing role.
#
# Custom format (-Fc) rather than plain SQL: it is compressed, and pg_restore can then run with
# -j for parallel restore and can skip individual objects if one of them fights you.

log "dumping Postgres globals (roles, passwords, tablespaces)"
runuser -u postgres -- pg_dumpall --globals-only > "$OUT/00-globals.sql"

DBS="$(runuser -u postgres -- psql -Atqc \
  "SELECT datname FROM pg_database WHERE datallowconn AND datname NOT IN ('template0','template1')")"
[ -n "$DBS" ] || die "no databases found, which cannot be right. Check Postgres is running."

for db in $DBS; do
  log "dumping database: $db"
  runuser -u postgres -- pg_dump -Fc --file="/var/tmp/.pgdump-$db.tmp" "$db"
  mv "/var/tmp/.pgdump-$db.tmp" "$OUT/10-db-$db.dump"
done

# Server version matters: a dump taken from 18 will not restore into 17. Record it so the
# new box gets the same major before anyone tries.
runuser -u postgres -- psql -Atqc "SELECT version()" > "$OUT/10-db-server-version.txt"
runuser -u postgres -- psql -Atqc \
  "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datallowconn" \
  > "$OUT/10-db-sizes.txt"

# ---------------------------------------------------------------------------
# 2. System state: what is installed, enabled, scheduled, and how nginx really resolves
# ---------------------------------------------------------------------------

log "capturing system state"
{
  echo "# hostname"; hostname -f
  echo; echo "# os"; cat /etc/os-release
  echo; echo "# kernel"; uname -a
  echo; echo "# cpu/mem"; nproc; free -h
  echo; echo "# disk"; df -h
  echo; echo "# node binaries"
  for n in /usr/bin/node /opt/nodejs/*/bin/node; do
    [ -x "$n" ] && printf '%s -> %s\n' "$n" "$("$n" -v)"
  done
} > "$OUT/20-system.txt" 2>&1

apt-mark showmanual            > "$OUT/20-apt-manual.txt" 2>&1 || true
dpkg --get-selections          > "$OUT/20-dpkg-selections.txt" 2>&1 || true
systemctl list-unit-files --state=enabled --no-pager --no-legend > "$OUT/20-enabled-units.txt" 2>&1 || true
systemctl list-timers --all --no-pager --no-legend               > "$OUT/20-timers.txt" 2>&1 || true
ufw status verbose             > "$OUT/20-ufw.txt" 2>&1 || true
ss -ltnp                       > "$OUT/20-listening-ports.txt" 2>&1 || true

# `nginx -T` prints the fully resolved config including every include. This is the artifact that
# tells you what the box ACTUALLY served, as opposed to what the repo thinks it served: the app
# and api vhosts exist only here and are in no git repository.
nginx -T                       > "$OUT/20-nginx-resolved.conf" 2>&1 || true

# Every user's crontab, not just root's. One of these carries a database password in the clear,
# which is exactly why this bundle must be encrypted and the password rotated on the new box.
{
  for u in $(cut -d: -f1 /etc/passwd); do
    out="$(crontab -l -u "$u" 2>/dev/null || true)"
    [ -n "$out" ] && { echo "### crontab: $u"; echo "$out"; echo; }
  done
} > "$OUT/20-user-crontabs.txt" 2>&1 || true

# pm2 keeps its process list in a JSON dump that `pm2 resurrect` reads at boot. Without it the
# GNFS app has to be re-registered by hand.
if [ -f /home/gnfs/.pm2/dump.pm2 ]; then
  cp /home/gnfs/.pm2/dump.pm2 "$OUT/20-pm2-dump.json"
fi

# ---------------------------------------------------------------------------
# 3. Files: config, TLS, secrets, sites, uploads
# ---------------------------------------------------------------------------
#
# One tarball, absolute paths preserved (tar strips the leading / and warns; that is fine and
# means it will not clobber the new box's / when unpacked into a staging directory).

TAR_EXCLUDES=(
  --exclude='*/.git'
  --exclude='*/.next/cache'
  --exclude='*/.npm/_cacache'
  --exclude='*/.cache'
  --exclude='*/logs/*.log'
)
if [ "$WITH_NODE_MODULES" != "1" ]; then
  TAR_EXCLUDES+=( --exclude='*/node_modules' )
fi

# Only paths that exist, so one missing directory does not abort the whole run.
CANDIDATES=(
  /etc/nginx
  /etc/letsencrypt
  /etc/postgresql
  /etc/fail2ban
  /etc/cron.d
  /etc/crontab
  /etc/gai.conf
  /etc/systemd/system
  /etc/evolutionprimeit
  /etc/ssh/sshd_config
  /etc/ssh/sshd_config.d
  /var/www
  /var/spool/cron
  /opt/taskbuddy/uploads
  /opt/taskbuddy/backup.env
  /opt/ep-contact
  /usr/local/bin
  /home/gnfs
)
PATHS=()
for p in "${CANDIDATES[@]}"; do
  [ -e "$p" ] && PATHS+=( "$p" )
done

# The app tree itself is a git clone and is rebuilt on the new box from the repo, so it is NOT
# archived wholesale (it is several GB of node_modules and build output). Its untracked secrets
# are, though, and those are the part that cannot be recovered from GitHub.
for env_file in /opt/taskbuddy/app/backend/.env /opt/taskbuddy/app/frontend/.env /opt/taskbuddy/app/frontend/.env.local /opt/taskbuddy/app/.env; do
  [ -f "$env_file" ] && PATHS+=( "$env_file" )
done

log "archiving ${#PATHS[@]} paths (node_modules included: $WITH_NODE_MODULES)"
tar --warning=no-file-changed --warning=no-file-removed \
    "${TAR_EXCLUDES[@]}" \
    -czf "$OUT/30-files.tar.gz" "${PATHS[@]}" \
  || { rc=$?; [ "$rc" -eq 1 ] || die "tar failed with exit $rc"; \
       warn "tar reported files changed while reading (exit 1). Usually harmless for logs; verify below."; }

tar -tzf "$OUT/30-files.tar.gz" > "$OUT/30-files-listing.txt" \
  || die "the archive is unreadable, which means it is not a backup. Investigate before proceeding."

# ---------------------------------------------------------------------------
# 4. Manifest, checksums, optional encryption
# ---------------------------------------------------------------------------

log "writing manifest"
{
  echo "TaskBuddy / Evolution Prime IT VPS migration bundle"
  echo "taken:    $TS (UTC)"
  echo "host:     $(hostname -f)"
  echo "source:   $(hostname -I | awk '{print $1}')"
  echo
  echo "databases dumped:"
  for db in $DBS; do echo "  - $db"; done
  echo
  echo "restore order: 00-globals.sql, then each 10-db-*.dump, then unpack 30-files.tar.gz"
  echo "runbook: docs/VPS-MIGRATION.md in the TaskBuddy repo"
} > "$OUT/MANIFEST.txt"

( cd "$OUT" && sha256sum ./* > SHA256SUMS 2>/dev/null || true )

if [ -n "${ENCRYPT_PASSPHRASE:-}" ]; then
  log "encrypting bundle (gpg symmetric, AES-256)"
  ( cd "$OUT_BASE" && tar -cf - "vps-migration-$TS" \
      | gpg --batch --yes --symmetric --cipher-algo AES256 \
            --passphrase-fd 3 -o "$OUT_BASE/vps-migration-$TS.tar.gpg" ) 3<<<"$ENCRYPT_PASSPHRASE"
  chmod 600 "$OUT_BASE/vps-migration-$TS.tar.gpg"
  sha256sum "$OUT_BASE/vps-migration-$TS.tar.gpg" > "$OUT_BASE/vps-migration-$TS.tar.gpg.sha256"
  rm -rf "$OUT"
  FINAL="$OUT_BASE/vps-migration-$TS.tar.gpg"
else
  chmod -R go-rwx "$OUT"
  FINAL="$OUT"
fi

log "done"
du -sh "$FINAL"
cat <<EOF

Bundle: $FINAL

Next, FROM YOUR LAPTOP (not from this shell):

  mkdir -p ~/vps-migration && scp -r gnfs-vps:$FINAL ~/vps-migration/

Then verify the copy arrived intact before you trust it:

  sha256sum ~/vps-migration/$(basename "$FINAL")

and compare against the value on this box. A bundle you have not verified off-box is not a backup.
$( [ -n "${ENCRYPT_PASSPHRASE:-}" ] && echo "
Decrypt later with:  gpg -d ~/vps-migration/$(basename "$FINAL") | tar -xf -" )
EOF
