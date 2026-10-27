# TaskBuddy Production Deployment (OVH VPS)

Operational runbook for the live deployment. **No secrets live in this file or in git** —
real credentials exist only in the VPS `.env` files (see the Environment section).

> History note: an earlier plan (`docs/superpowers/plans/2026-06-28-taskbuddy-deployment.md`)
> targeted Railway. The production deployment instead uses an OVH VPS (owner already pays for it,
> and the backend needs a persistent WebSocket host). This document describes what is actually running.

## Topology

Single OVH VPS (Ubuntu, 2 vCPU / 4 GB RAM / 2 GB swap), all services **native (no Docker)**,
coexisting with two other workloads on the same box (GNFS and the Evolution Prime IT site; do not
touch their services, DBs, or nginx vhosts). See *Coexists with two other workloads* under Gotchas.

```
Cloudflare DNS (grey-cloud A records) ──► VPS public IP
                                            │
                            nginx (shared)  ── TLS via Certbot/Let's Encrypt
                            ├─ api.gettaskbuddy.com ─► 127.0.0.1:3100  backend  (Express + Socket.io)
                            └─ app.gettaskbuddy.com ─► 127.0.0.1:3200  frontend (Next.js)
                                            │
                            Postgres 18 (shared, localhost) ── DB `taskbuddy`, role `taskbuddy_app`
                            Cloudflare R2 ── bucket `taskbuddy-uploads` served at cdn.gettaskbuddy.com
```

## Services (systemd)

| Unit | Command | Bind | User | WorkingDirectory |
|------|---------|------|------|------------------|
| `taskbuddy-backend` | `node dist/index.js` | `127.0.0.1:3100` | `taskbuddy` | `/opt/taskbuddy/app/backend` |
| `taskbuddy-frontend` | `next start -p 3200` | `127.0.0.1:3200` | `taskbuddy` | `/opt/taskbuddy/app/frontend` |

Both run as the non-login `taskbuddy` service user. nginx and Postgres are shared with GNFS.

```bash
sudo systemctl status  taskbuddy-backend taskbuddy-frontend
sudo systemctl restart taskbuddy-backend
sudo journalctl -u taskbuddy-backend -n 100 --no-pager
```

### API concurrency (CLUSTER_WORKERS)

The API is single-process by default. The 2026-09-15 load test found it CPU-bound on one core, so
setting `CLUSTER_WORKERS=2` in `backend/.env` forks two workers across the two cores. It uses the
Socket.IO cluster adapter + sticky sessions (no Redis) so live updates still reach every client, and
crons run only on worker 1 so they never double-fire. Keep `CLUSTER_WORKERS * connection_limit` well
under Postgres `max_connections=100` (2 * 15 = 30, fine). On this 2-core box the box also runs the
frontend, Postgres and nginx, so 2 workers is a partial gain; the full doubling wants a 4-core VPS.
**Enable it, restart, and re-run the load test (`.do_not_upload/loadtest`) before relying on it.**

### Node runtime (Node 24 LTS, side-by-side, via `/opt/nodejs/lts`)

TaskBuddy runs on the **current Node LTS (24 since 2026-10-27), reached through the symlink
`/opt/nodejs/lts`**, which points at a versioned folder such as `/opt/nodejs/node-v24.22.1-linux-x64`.
It is deliberately **not** on any `PATH`. The box's system `/usr/bin/node` stays **v20** because GNFS
shares it: never upgrade that in place. Only the TaskBuddy units point at the app's Node, via systemd
**drop-ins** (base units untouched), kept in the repo under `deploy/systemd/`:

- `taskbuddy-backend.service.d/node.conf`: `ExecStart=/opt/nodejs/lts/bin/node dist/index.js`.
- `taskbuddy-frontend.service.d/node.conf`: `Environment=PATH=/opt/nodejs/lts/bin:...` so `next`'s
  `#!/usr/bin/env node` shebang resolves the app's Node. (`loopback.conf` is separate and unchanged.)

Because every unit, script and command goes through `/opt/nodejs/lts`, **a Node upgrade or a
rollback is: unpack the new version, move that one link, `npm ci`, build, restart.** The older
`/opt/nodejs/22` link is kept only as a fallback for the backup scripts during the rollback window.

Install a new Node version (patch or major), then rebuild native modules (bcrypt/sharp/Prisma):
```bash
V=v24.22.1                      # pick from https://nodejs.org/dist/latest-v24.x/
cd /tmp && curl -fsSLO https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz
curl -fsSL https://nodejs.org/dist/$V/SHASUMS256.txt | grep "node-$V-linux-x64.tar.xz" | sha256sum -c -   # must say OK
sudo tar -xJf node-$V-linux-x64.tar.xz -C /opt/nodejs --no-same-owner
sudo ln -sfn /opt/nodejs/node-$V-linux-x64 /opt/nodejs/lts

cd /opt/taskbuddy/app
export NODEBIN=/opt/nodejs/lts/bin
sudo -u taskbuddy env PATH=$NODEBIN:$PATH npm ci
sudo -u taskbuddy env PATH=$NODEBIN:$PATH npm run build          # db:generate + backend + frontend
sudo -u taskbuddy $NODEBIN/node -e "require('bcrypt'); require('sharp'); console.log('native OK')"
sudo systemctl restart taskbuddy-backend taskbuddy-frontend
```
**Rollback:** point the link back (`sudo ln -sfn /opt/nodejs/node-v22.23.4-linux-x64 /opt/nodejs/lts`),
then the same `npm ci` + build + restart. A MAJOR change of Node changes the native-module ABI, so
the `npm ci` is required in both directions, not optional.

```bash
sudo cp /opt/taskbuddy/app/deploy/systemd/taskbuddy-backup.* /etc/systemd/system/
sudo cp '/opt/taskbuddy/app/deploy/systemd/taskbuddy-backup-notify@.service' /etc/systemd/system/
sudo systemctl daemon-reload
```

**Node version:** these run as root, whose PATH resolves `/usr/bin/node` (v20, shared with GNFS).
The scripts resolve `/opt/nodejs/lts/bin/node` explicitly (then `/opt/nodejs/22`, then PATH) and the
notify unit sets `PATH` to prefer it, so the backup path runs on the app's Node. The AWS SDK requires
`node >=22` for releases after January 2027. Verify with:
```bash
sudo journalctl -u taskbuddy-backup.service -n 30 --no-pager | grep -i "NodeVersionSupportWarning" \
  && echo "still on Node 20" || echo "no version warning: running the app's Node"
```
Manual restore: `gunzip -c taskbuddy-<ts>.sql.gz | psql <target-db>`.

### Restore testing

An untested backup is not a backup. `scripts/backup-restore-test.sh` downloads the latest dump,
restores it into a throwaway database, checks the contents, and drops the scratch DB again.
Production is never written to — it refuses to run unless the scratch name contains `restore_test`.

```bash
sudo bash -c "set -a; . /opt/taskbuddy/backup.env; set +a; \
  exec /opt/taskbuddy/app/scripts/backup-restore-test.sh"
```

Checks: table count, non-empty `users`/`families`, bcrypt hashes surviving the round-trip, and
row + migration counts compared against production **as of the backup's own timestamp** (a fixed
number, unlike live totals which drift as users sign up). `KEEP=1` retains the scratch DB.

It also preflights free space — the scratch restore is a full second copy, and Postgres shares
this volume with GNFS — and refuses rather than risk filling the disk. `SKIP_DISK_CHECK=1` overrides.

Re-run it after any migration: a dump predating a deploy legitimately lacks that deploy's
migration, and the script reports exactly which ones are missing rather than failing.

**Quote any value containing spaces in `backup.env`.** systemd's `EnvironmentFile` parser tolerates
`SMTP_FROM=TaskBuddy <alerts@…>` unquoted, but sourcing it in a shell does not — the `<` is read as
a redirect, and *every variable defined after that line is silently dropped*. Use
`SMTP_FROM='TaskBuddy <alerts@…>'`.

### Failure alerts (email)

If a backup run fails, `taskbuddy-backup.service` has `OnFailure=taskbuddy-backup-notify@%n.service`,
which runs `scripts/notify-failure.mjs` to email `ALERT_EMAIL` the failure plus the unit's journal
tail (via the app's nodemailer + the `SMTP_*` keys in `backup.env`). A successful backup sends nothing.

Test it without breaking anything (point the backup at a bogus DB so it fails once):
```bash
sudo systemd-run --unit=tb-backup-test --property=OnFailure=taskbuddy-backup-notify@tb-backup-test.service \
  --property=EnvironmentFile=/opt/taskbuddy/backup.env --property=Environment=DB_NAME=does_not_exist \
  /opt/taskbuddy/app/scripts/backup-db.sh
# → backup fails on pg_dump, OnFailure fires, you get an email. Then check:
sudo journalctl -u 'taskbuddy-backup-notify@*' -n 20 --no-pager   # "alert sent to …"
```

## Monitoring

Two failure surfaces are watched; both alert by email.

**1. Backups** — `taskbuddy-backup.service` emails on failure via the `OnFailure=` handler above.

**2. Liveness / health** — external [UptimeRobot](https://uptimerobot.com) monitors (5-min interval,
email alert contact), so an outage pages us even if the whole VPS is down (nothing on-box can):

| Monitor | Type | Target | Alert condition |
|---------|------|--------|-----------------|
| API health | Keyword | `https://api.gettaskbuddy.com/health` | keyword `"db":"up"` **absent** |
| Frontend | HTTP(s) | `https://app.gettaskbuddy.com` | non-2xx |

The `/health` endpoint (`backend/src/index.ts`) returns `200 {"status":"ok","db":"up"}` when the DB is
reachable and `503 {"status":"error","db":"down"}` otherwise — the keyword monitor catches both a 503
and any 200 that lost the keyword. Verify manually:
```bash
curl -s https://api.gettaskbuddy.com/health      # {"status":"ok","db":"up"}
```

## Account deletion, and the switch that makes it real

A parent can delete their family account from the app (Settings, Delete account) and from the web
settings page. That action **schedules**: it sets `family.deleted_at` and reports a date
`RETENTION_DAYS` later. The erasure itself is done by the retention sweep, which deletes the
evidence objects from R2, redacts the audit and email logs, and then hard-deletes the family row.

> ⚠️ **`RETENTION_PURGE_ENABLED` must be `true` in production.** It defaults to **false**, and while
> it is off the sweep logs what it would purge and deletes nothing. A parent would be told in the app
> and by email that their data goes on a given date, and it never would. That makes
> `ACCOUNT_DELETION.md` and `PRIVACY.md` false, which is the compliance exposure the whole feature
> exists to close.

Both variables live in `backend/.env` (see `backend/.env.example`):

```
RETENTION_DAYS=30              # recovery window; MUST match PRIVACY.md and ACCOUNT_DELETION.md
RETENTION_PURGE_ENABLED=true   # defaults to false — nothing is ever erased while it is off
```

Verify after the deploy that sets it, before trusting the promise:

```bash
# 1. The dry-run line disappears once purging is live. With it OFF you see
#    "[Retention] DRY RUN - N family(ies) ... would be hard-deleted".
sudo journalctl -u taskbuddy-backend --since '1 hour ago' | grep -i retention

# 2. Nothing should sit soft-deleted for longer than the window.
sudo -u postgres psql taskbuddy -c \
  "SELECT id, deleted_at FROM families WHERE deleted_at < now() - interval '30 days'"
```

Row 2 returning anything means the sweep is not purging: either the switch is still off, or the job
is failing. Both are silent by design, so this query is the check that matters.

## Log retention (journald) — F-10f

`morgan('combined')` writes an access line per request to stdout, which systemd captures into
journald. **Those lines contain client IP addresses, which are personal data under GDPR**, so their
retention is a privacy commitment, not just an ops setting — `PRIVACY.md` §6.3 states **30 days**.

**Current state: journald runs on stock defaults** — `/etc/systemd/journald.conf` has no
uncommented settings. Defaults are **size**-bounded (`SystemMaxUse` ≈ 10% of the filesystem, capped
at 4 GB) with **no time limit**, so entries survive until disk pressure rotates them out. On a
low-traffic box that can be far longer than 30 days, which would put the deployment out of step with
the published policy.

**Required setting** (owner, needs sudo):

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/taskbuddy-retention.conf >/dev/null <<'EOF'
# Bound personal data (request IPs from morgan access logs) to the retention period
# published in PRIVACY.md section 6.3. See docs/DEPLOYMENT.md "Log retention".
[Journal]
MaxRetentionSec=30day
EOF
sudo systemctl restart systemd-journald
```

A drop-in is used rather than editing `journald.conf` so the setting survives package upgrades and
stays visibly ours. Note it is **host-wide** — it also caps GNFS's logs on this shared box; 30 days
is well beyond what either service needs for debugging.

Verify:

```bash
systemctl show systemd-journald -p Environment >/dev/null; journalctl --disk-usage
journalctl -u taskbuddy-backend --no-pager -o short-iso | head -1   # oldest retained entry
```

If the published retention figure in `PRIVACY.md` §6.3 ever changes, change it here too — they are
a pair.

## Gotchas

- **`prisma db execute` cannot be used to inspect data.** It executes statements and prints nothing,
  so a `SELECT` piped into it "succeeds" with empty output and looks like an empty table. It also
  requires `--schema` or `--url`, and without one fails with `Either --url or --schema must be
  provided`. To actually read rows on the box, use `psql` — but **do NOT source `backend/.env` to get
  the URL.** It contains `SMTP_FROM=TaskBuddy <no-reply@gettaskbuddy.com>` unquoted; dotenv and
  systemd's `EnvironmentFile` tolerate that, but to a shell `<` is a redirect, so `. ./.env` dies with
  ``syntax error near unexpected token `newline` ``. Extract the one variable instead:
  ```bash
  sudo -u taskbuddy bash -c 'cd /opt/taskbuddy/app/backend && \
    line=$(grep -m1 "^DATABASE_URL=" .env) && url=${line#DATABASE_URL=} && \
    url=${url%\"} && url=${url#\"} && \
    psql "$url" -c "SELECT category, level, title FROM game_definitions ORDER BY 1,2;"'
  ```
  No `eval`: a quoted assignment means a `?schema=…&…` in the URL cannot be reinterpreted as shell
  syntax. This is the same trap as the `backup.env` quoting gotcha below — the difference is that
  `backup.env` failed *silently* (every variable after the bad line was dropped) whereas sourcing
  `backend/.env` fails loudly. Neither file should be shell-sourced.

  `prisma migrate status` remains the check for whether migrations applied (cwd must be `backend/`).
- **Coexists with two other workloads on this box.** TaskBuddy uses ports 3100/3200 and its own
  DB/role, and collides with neither. Never edit their config.
  - **GNFS**: Next.js under PM2 (user `gnfs`) on **`:3000`**, DB `gnfs`, vhost
    `gnfs.evolutionprimeit.com`.
  - **Evolution Prime IT**: static site at `/var/www/evolutionprimeit` plus a contact-form
    handler, `ep-contact.service` (systemd, user `www-data`), on **`:3001`**. Its vhost proxies
    only `location /api/` to that port.

  Earlier revisions of this file listed GNFS on `:3001`. That was a misattribution: `:3001` has
  always belonged to `ep-contact`, and GNFS is pinned to `:3000` by `PORT` in its
  `ecosystem.config.js` (with no `PORT` in its `.env` to override it). Corrected 2026-08-09.

  **Keep `PORT=3100` in `backend/.env`.** `backend/src/config/index.ts` falls back to **3001** when
  `PORT` is unset, the one number on this box that is already taken. The systemd unit sets no
  `PORT`, so that `.env` line is the only thing preventing the backend from racing `ep-contact` for
  the port on its next restart. Verify with `ss -tlnp 'sport = :3100'` after any env change.
- **Set `HOST=127.0.0.1` in `backend/.env`.** Unset, the API listens on every interface, so port
  3100 is reachable directly and only ufw stands in front of it. With it, the API answers only
  through nginx. Local development leaves it unset so a phone on the LAN can reach the laptop.
- **No Redis** at launch (single instance). The signed-out access-token list
  (`backend/src/utils/accessDenylist.ts`) lives in process memory for the same reason, refilled from
  `refresh_sessions` at boot. Running a second backend process would need it moved to Postgres or
  Redis, or a device signed out on one process would keep working on the other.
- **Shared package** (`@taskbuddy/shared`) must resolve to its compiled `dist/` at runtime
  (its `package.json` exports point there); `node dist/index.js` cannot run the TS source.
- Backend must `trust proxy` in production (set) so rate limiting keys on the real client IP.
- **The frontend must be BUILT and SERVED by the same Next.js.** `ExecStart` runs
  `<repo>/node_modules/.bin/next`, while `npm run build:frontend` resolves `next` from
  `frontend/`. If a second copy ever lands in `frontend/node_modules/next`, those are two
  different programs and the mismatch is invisible to a green build.

  This caused a production outage on 2026-07-27: `frontend/` held `16.3.0-canary.94`, the root
  held stable `16.2.11`, and the canary build emitted route code reading the canary-only config
  key `experimental.instantInsights.validationLevel`. The stable runtime never populates it, so
  **every dynamic (`ƒ`) route returned 500** — `/parent/tasks/[id]`, `/parent/children/[id]`, the
  `/parent/approve/[assignmentId]` email deep-link — while static pages, being prebuilt HTML,
  looked perfectly healthy. Symptom in `journalctl -u taskbuddy-frontend`:
  `TypeError: Cannot read properties of undefined (reading 'validationLevel')`.

  `next` is now pinned exactly (no caret) in `frontend/package.json`, and
  `frontend/tests/next-version-single.test.ts` fails CI if a second or prerelease copy reappears.
  To check by hand on the box:
  ```bash
  cd /opt/taskbuddy/app && node -e "console.log(require(require.resolve('next/package.json',{paths:['./frontend']})).version)" && node -p "require('./node_modules/next/package.json').version"
  ```
  The two must be identical. Smoke-test a dynamic route after any frontend deploy — `/health` and
  the login page cannot detect this class of failure:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://app.gettaskbuddy.com/parent/tasks/abc123   # expect 200
  ```

## Pending / TODO

- **Node 22 — native modules verified**, see *Node 22 verification* below. Still worth doing once
  through the UI: a real parent login and a real avatar upload, to cover the full request path
  (multer limits, R2 credentials, CDN URL) rather than just the bindings.
- **Legal pages blocked on legal review**: `PRIVACY.md` / `TERMS.md` are unreviewed drafts, so
  `/privacy` and `/terms` are withheld by the build. App stores will want those URLs.
- **Certificate renewal never exercised** for the apex — `sudo certbot renew --dry-run`.
  Current cert expires 2026-10-19.
- **Retire the GoDaddy placeholder** now that the apex is served from the VPS, and drop the stale
  `_domainconnect` CNAME it left in Cloudflare.
- Optional maintenance: `eslint-config-next` 14 → 16 would clear the three minimatch allowlist
  entries (DEP-04). Lint-only risk, two majors of config churn — maintenance, not security.

Done (2026-07-21): secret rotation (JWT/admin-code/DB password/SMTP/uploads token), Node 22 LTS
install + cutover, prod DB role confirmed least-privilege (`taskbuddy_app`, all role flags = f),
login lockout hardening (PRs #10/#12) deployed with the first production schema migration,
**backup restore-test** — first run against the live backups proved them recoverable (23 tables,
exact row match vs production as of the backup's timestamp, bcrypt hashes intact), backup + notify
units moved onto Node 22, dependency re-triage (body-parser DoS patched, dead js-yaml allowlist
entry removed, fast-uri host confusion GHSA-4c8g-83qw-93j6 patched), and the **apex marketing site
live on TLS** (Let's Encrypt, `gettaskbuddy.com` + `www`, expires 2026-10-19).

## Node 22 verification (2026-07-21)

The cutover risk is native modules (`bcrypt`, `sharp`) failing to load against a new ABI. Both were
exercised directly under the Node 22 binary, in the deployed `backend/` tree:

```bash
cd /opt/taskbuddy/app/backend
/opt/nodejs/22/bin/node -e 'require("bcrypt").hash("x",12).then(h=>require("bcrypt").compare("x",h)).then(console.log)'
/opt/nodejs/22/bin/node -e 'const s=require("sharp");console.log(s.versions.vips)'
```

Results — backend runs `/opt/nodejs/22/bin/node dist/index.js` (confirmed via `/proc/<pid>/cmdline`):

| Check | Result |
|-------|--------|
| Node (TaskBuddy units) | v22.23.1 |
| Node (`/usr/bin/node`, GNFS) | v20.20.2 — untouched |
| `bcrypt` hash + compare | passes (match true, mismatch false) |
| `sharp` 0.34.5 / libvips 8.17.3 | 300×300 `fit:cover` thumbnail produced |
| `/health` | `{"status":"ok","db":"up"}` |
| Frontend | HTTP 200 |
| GNFS (`pm2-gnfs.service`) | active, **0 restarts, up since 2026-07-08** (recorded as `:3001` at the time; actually `:3000`, see Gotchas) |

GNFS's zero restarts across the 07-21 cutover is the evidence it was never disturbed. The frontend
unit carries no `ExecStart` override — it inherits Node 22 purely through
`Environment=PATH=/opt/nodejs/22/bin:…` and `next`'s `#!/usr/bin/env node` shebang; both units were
restarted at 00:27:05, after the drop-ins were written at 00:23:14, so the drop-ins are in effect.

Note: a bogus-credential login is **not** a valid `bcrypt` test — `AuthService.login` returns 401
before the compare when the email is unknown (`backend/src/services/auth.ts:134`). And never probe
child PINs: any failed attempt locks that child's account for 15 minutes (`auth.ts:219`).
