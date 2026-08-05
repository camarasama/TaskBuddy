# TaskBuddy Production Deployment (OVH VPS)

Operational runbook for the live deployment. **No secrets live in this file or in git** —
real credentials exist only in the VPS `.env` files (see the Environment section).

> History note: an earlier plan (`docs/superpowers/plans/2026-06-28-taskbuddy-deployment.md`)
> targeted Railway. The production deployment instead uses an OVH VPS (owner already pays for it,
> and the backend needs a persistent WebSocket host). This document describes what is actually running.

## Topology

Single OVH VPS (Ubuntu, 2 vCPU / 4 GB RAM / 2 GB swap), all services **native (no Docker)**,
coexisting with another app on the same box (GNFS — do not touch its services, DB, or nginx vhosts).

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

### Node runtime (Node 22, side-by-side)

TaskBuddy runs on **Node 22 LTS installed at `/opt/nodejs/22`** (isolated prefix, deliberately **not**
on any `PATH`). The box's system `/usr/bin/node` stays **v20** because GNFS shares it — never upgrade
that in place. Only the TaskBuddy units point at Node 22, via systemd **drop-ins** (base units untouched):

- `/etc/systemd/system/taskbuddy-backend.service.d/node22.conf` — overrides `ExecStart` to
  `/opt/nodejs/22/bin/node dist/index.js`.
- `/etc/systemd/system/taskbuddy-frontend.service.d/node22.conf` — sets
  `Environment=PATH=/opt/nodejs/22/bin:/usr/local/bin:/usr/bin:/bin` so `next`'s `#!/usr/bin/env node`
  shebang resolves Node 22.

Install a new Node 22 patch (or first-time), then rebuild native modules (bcrypt/sharp are ABI-sensitive):
```bash
# fetch latest v22 into /opt/nodejs (arch-aware), repoint the /opt/nodejs/22 symlink:
ARCH=$(uname -m); case "$ARCH" in x86_64) NA=x64;; aarch64) NA=arm64;; esac
TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-${NA}\.tar\.xz" | head -1)
sudo mkdir -p /opt/nodejs && curl -fsSL "https://nodejs.org/dist/latest-v22.x/${TARBALL}" -o "/tmp/${TARBALL}"
sudo tar -xJf "/tmp/${TARBALL}" -C /opt/nodejs && sudo ln -sfn "/opt/nodejs/${TARBALL%.tar.xz}" /opt/nodejs/22

sudo systemctl stop taskbuddy-frontend taskbuddy-backend
cd /opt/taskbuddy/app
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm ci
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm run build
sudo -u taskbuddy /opt/nodejs/22/bin/node -e "require('bcrypt'); require('sharp'); console.log('native OK')"
sudo systemctl start taskbuddy-backend taskbuddy-frontend
```
**Rollback to system Node 20:** `sudo rm -f /etc/systemd/system/taskbuddy-*.service.d/node22.conf && sudo systemctl daemon-reload`,
then `sudo -u taskbuddy npm ci && npm run build` (now under `/usr/bin/node`) and restart both units.

## Filesystem layout

```
/opt/taskbuddy/app                     # git repo (cloned via read-only GitHub deploy key)
/opt/taskbuddy/.ssh/id_ed25519         # deploy key (pulls only)
/opt/taskbuddy/app/backend/.env        # backend secrets (chmod 600, owner taskbuddy)
/opt/taskbuddy/app/frontend/.env.production  # frontend build/runtime env
/opt/taskbuddy/uploads                 # local upload fallback (unused; R2 is active)
```

## Database

Postgres 18 (shared instance). Database `taskbuddy` owned by least-privilege role
`taskbuddy_app` — **not** superuser (no `SUPERUSER`/`REPLICATION`/`BYPASSRLS`).

Apply migrations (production uses `migrate deploy`, never `db push`):
```bash
cd /opt/taskbuddy/app
sudo -u taskbuddy npm -w backend run db:migrate:prod
```

## Environment / secrets

Secrets live **only** in the VPS `.env` files, never in git. The full variable contract
(names + safe placeholder values) is documented in:
- `backend/.env.example`
- `frontend/.env.example`

Production-set groups: server URLs (`API_URL`, `CLIENT_URL`, `FRONTEND_URL`,
`CROSS_ORIGIN_COOKIES=true`), `DATABASE_URL`, JWT secrets, `ADMIN_INVITE_CODE`,
storage (`STORAGE_PROVIDER=r2` + `R2_*` + `cdn.gettaskbuddy.com`), SMTP (ZeptoMail),
Web Push (`VAPID_*`), and Sentry (`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`).

`NEXT_PUBLIC_*` values are baked into the frontend bundle **at build time** — changing them
requires a frontend rebuild, not just a restart.

### Sentry source maps (frontend) — build-time only

Three variables control whether browser stack traces are **readable**. They are needed by
`npm run build:frontend`, and because this project builds **on the VPS**, they have to exist here —
not just on a developer laptop:

| Variable | Value |
|---|---|
| `SENTRY_ORG` | `evolution-prime-it-ltd` |
| `SENTRY_PROJECT` | `taskbuddy-frontend` |
| `SENTRY_AUTH_TOKEN` | an **organization** auth token (`sntrys_…`) with release/source-map write scope |

Use an **organization** token, not a personal one — the same type the mobile app uses for its EAS
secret. Org tokens embed their own region, so `sentry-cli` resolves the right endpoint without
`SENTRY_URL` being set; do not add one. (Note the asymmetry: the *read* REST API for this org is
`de.sentry.io`, but uploads via an org token are not configured that way.)

**Without the token the build still succeeds** — it simply uploads nothing, and stack traces stay
minified. That is deliberate: an absent secret must never break a deploy. It is also why the plugin's
"No auth token provided" warning is left un-silenced, since it is the only signal that traces will be
unreadable.

⚠️ **The same absence also disables source-map *generation*, on purpose.** The Sentry plugin turns on
browser source maps so it has something to upload; with no upload, nothing cleans them up and the
`.map` files would be served publicly — publishing the app's source. `next.config.js` therefore sets
`sourcemaps.disable` when no token is present. Verified both ways: a token-less build emits zero
`.map` files, and a build with an *invalid* token generates them but still deletes them after the
failed upload.

The token is a write credential: keep it out of git, `chmod 600`, and rotate it if it is ever pasted
somewhere it shouldn't be.

The `.env` files are `chmod 600` owned by `taskbuddy`, so run manual scripts that read them as
`sudo -u taskbuddy` (otherwise `dotenv` silently skips the unreadable file).

## Deploy / update

Run npm under Node 22 (`PATH=/opt/nodejs/22/bin:$PATH`) — see the Node runtime section. Without it
these commands run under `/usr/bin/node` v20 and can rebuild native modules against the wrong ABI.

```bash
cd /opt/taskbuddy/app
export N22=/opt/nodejs/22/bin                # Node 22, matching the systemd drop-ins

sudo -u taskbuddy git pull
sudo -u taskbuddy env PATH=$N22:$PATH npm ci                 # only if package-lock.json moved

# --- if prisma/schema.prisma changed, BOTH of these, in this order, BEFORE any restart ---
sudo -u taskbuddy env PATH=$N22:$PATH npm -w backend run db:migrate:prod
sudo -u taskbuddy env PATH=$N22:$PATH npm run db:generate

sudo -u taskbuddy env PATH=$N22:$PATH npm run build:backend  # after backend changes
sudo -u taskbuddy env PATH=$N22:$PATH npm run build:frontend # after frontend changes OR any NEXT_PUBLIC_* change

# --- one-off DATA-migration scripts (if the deploy ships any) — AFTER migrate:prod AND after the ---
# --- build, BEFORE restart. They query the new columns and run from compiled dist/. Idempotent.  ---
# e.g. F-4 private evidence:
# sudo -u taskbuddy env PATH=$N22:$PATH node backend/dist/scripts/migrate-evidence-private.js

sudo systemctl restart taskbuddy-backend
sudo systemctl restart taskbuddy-frontend
```

**Three ordering traps around schema changes** — all bite at request time, not deploy time, so the
deploy looks clean and the app breaks for real users:

1. **Migrate before restarting.** Reversed, the new code queries columns that do not exist yet.
2. **`db:generate` is not part of `build:backend`.** Only the root `npm run build` chains it
   (`db:generate && build:backend && build:frontend`), so building the backend alone leaves the
   generated Prisma client blind to new columns. Run it explicitly, or use the full `npm run build`.
3. **One-off DATA-migration scripts run last (after `migrate:prod` + build), not first.** A script
   like `backend/dist/scripts/migrate-evidence-private.js` reads the columns the schema migration
   adds and runs from compiled `dist/` — so it needs BOTH `db:migrate:prod` and the build to have
   happened. Run before `migrate:prod` it dies with `P2022: column … does not exist` (this bit the
   F-4 evidence migration on 2026-07-23). These scripts are written idempotent, so a failed early
   run is safe to re-run once ordered correctly.

**⚠️ `backfill-game-banks.js` is SUPERSEDED — do not run it again.** It only ever APPENDS questions,
while `retier-maths-beginner.js` (run 2026-07-31) deliberately RETIRED five from the maths beginner
bank — percentages, indices, roots, order of operations, all intermediate material. Running the
backfill now would silently add them straight back and undo the re-tier, with no error and no visible
symptom until someone notices the beginner level is not beginner. If both ever run in one deploy, the
re-tier must go LAST. The script's own header carries the same warning.

**One-off scripts load `.env` by absolute path, so they run from any directory.** They import
`../config`, which resolves `backend/.env` from `__dirname`. Do NOT reintroduce
`import 'dotenv/config'` in a script: that resolves `.env` from the WORKING DIRECTORY, and there is
no `.env` at the repo root on the VPS — so the script only works when invoked from `backend/` and
otherwise fails with an unset `DATABASE_URL` rather than a clear message.

Take a fresh backup before any migration: `sudo systemctl start taskbuddy-backup.service`.

**Pre-flight: JWT secret strength (hard boot gate).** The backend refuses to start if `JWT_SECRET`
or `JWT_REFRESH_SECRET` is under 32 bytes (`validateConfig`). If you rotate a secret, check the new
value's length *before* restarting, or the service will fail to come back up:
```bash
cd /opt/taskbuddy/app
sudo -u taskbuddy env PATH=$N22:$PATH node -e "require('dotenv').config({path:'backend/.env'});const b=s=>Buffer.byteLength(process.env[s]||'','utf8');console.log('JWT_SECRET',b('JWT_SECRET'),'| JWT_REFRESH_SECRET',b('JWT_REFRESH_SECRET'))"
# both must be >= 32
```
If the backend won't boot after a deploy, this is the first thing to check:
`journalctl -u taskbuddy-backend -n 30` → "must be at least 32 bytes".

**Auth-hardening deploys force a one-time re-login.** Changes to the refresh-session store or the
JWT issuer/audience/algorithm pinning invalidate every token minted before the deploy: the first
`/auth/refresh` returns 401 and the client sends the user to log in once (parents by password,
children by PIN). This is expected — **tell the family testers before deploying**, and if several
such changes are pending, deploy them together so it is a single re-login event, not several.

Health check: `curl -s https://api.gettaskbuddy.com/health` → `{"status":"ok","db":"up"}`.

`/health` only pings the DB — it does **not** prove a migration applied, since it never touches
`users`. To verify new columns are really live, attempt a login with a bogus email: Prisma's
`findUnique` selects every scalar column, so a missing one errors even when no row matches.
`401` = schema is good; `500` = the migration did not apply.
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.gettaskbuddy.com/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"nobody@example.invalid","password":"x"}'
```

## Marketing site (apex)

`gettaskbuddy.com` serves a **static** marketing site — no application server, separate from the
Next.js app on `app.`. Source in `marketing/src`, built to `marketing/dist` (gitignored).

```bash
cd /opt/taskbuddy/app
sudo -u taskbuddy git pull
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm ci          # see note below
sudo -u taskbuddy env PATH=/opt/nodejs/22/bin:$PATH npm run build:marketing
sudo mkdir -p /var/www/taskbuddy-marketing
sudo rsync -a --delete marketing/dist/ /var/www/taskbuddy-marketing/
```

`npm ci` is needed whenever `package-lock.json` moved — the build imports `marked`, a
**devDependency**, so a deploy that skips it fails with `ERR_MODULE_NOT_FOUND: Cannot find
package 'marked'` (this happened on the first marketing deploy). Skip it only when the pull
touched no lockfile. Note `npm ci` deletes and reinstalls `node_modules` while the backend and
frontend are running out of it, so check them afterwards:

```bash
curl -s https://api.gettaskbuddy.com/health          # {"status":"ok","db":"up"}
curl -s -o /dev/null -w '%{http_code}\n' https://app.gettaskbuddy.com
sudo systemctl restart taskbuddy-backend taskbuddy-frontend   # only if either misbehaves
```

No restart needed — nginx serves the files directly. First-time vhost install:

```bash
sudo cp deploy/nginx/gettaskbuddy.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/gettaskbuddy.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d gettaskbuddy.com -d www.gettaskbuddy.com
```

**DNS:** the apex and `www` must point at the VPS (`54.37.18.27`) as **grey-cloud** A records in
Cloudflare, matching `api.`/`app.`. They currently resolve to Cloudflare-proxied IPs fronting a
GoDaddy Website Builder placeholder — that must be repointed before certbot can issue, and the
GoDaddy site can then be retired.

### Legal pages are gated on purpose

`marketing/build.mjs` generates `/privacy` and `/terms` from `PRIVACY.md` and `TERMS.md`, but
**refuses while either still contains its `DRAFT TEMPLATE` warning**. Both currently say they are
not legal advice and need a lawyer's review before publication, because TaskBuddy is directed at
children and falls under COPPA, GDPR/GDPR-K and the UK Children's Code — publishing them would
present unreviewed drafts to parents as binding policy.

The gate is not a flag to flip. Replace the drafts with reviewed text and the pages build
themselves, with footer links added automatically; until then nothing links to a 404. The build
prints what it withheld on every run.

## TLS

Per-subdomain via Certbot's nginx plugin:
```bash
sudo certbot --nginx -d api.gettaskbuddy.com
sudo certbot --nginx -d app.gettaskbuddy.com
```
**IPv6 note:** the VPS has IPv6 addresses but no default IPv6 route, which made Certbot fail
("Network is unreachable"). Fixed persistently by preferring IPv4 in `/etc/gai.conf`:
`precedence ::ffff:0:0/96  100`.

## Backups

Nightly Postgres backup to a **separate private** R2 bucket (`taskbuddy-backups` — never
`taskbuddy-uploads`, which is public via the CDN). Server-side encrypted at rest by R2;
14-day retention with automatic pruning.

- `scripts/backup-db.sh` — `pg_dump` (peer auth) → gzip → upload → prune.
- `scripts/backup-r2-upload.mjs` — R2 upload + retention pruning (uses the app's AWS SDK).
- `deploy/systemd/taskbuddy-backup.{service,timer}` — nightly run at 02:30 UTC (`Persistent=true`).
- Credentials for the backups bucket live in `/opt/taskbuddy/backup.env` (chmod 600, root-owned,
  never committed) — a token scoped to `taskbuddy-backups` only.

`backup.env` contract (all read by the systemd units, never committed):
```
R2_ACCOUNT_ID=          R2_ACCESS_KEY_ID=       R2_SECRET_ACCESS_KEY=
R2_BACKUP_BUCKET=taskbuddy-backups   RETENTION_DAYS=14        # optional (defaults shown)
# Failure alerts (see below) — reuse the same SMTP provider as the app (ZeptoMail):
SMTP_HOST=  SMTP_PORT=465  SMTP_USER=  SMTP_PASS=  SMTP_FROM='TaskBuddy <alerts@…>'
ALERT_EMAIL=you@example.com
```

Install / operate:
```bash
sudo cp deploy/systemd/taskbuddy-backup.* /etc/systemd/system/
sudo cp 'deploy/systemd/taskbuddy-backup-notify@.service' /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now taskbuddy-backup.timer
sudo systemctl start taskbuddy-backup.service     # run one now
systemctl list-timers taskbuddy-backup.timer      # next scheduled run
```

The units under `deploy/systemd/` are **copies** — a `git pull` that changes them has no effect
until they are re-copied and reloaded:
```bash
sudo cp /opt/taskbuddy/app/deploy/systemd/taskbuddy-backup.* /etc/systemd/system/
sudo cp '/opt/taskbuddy/app/deploy/systemd/taskbuddy-backup-notify@.service' /etc/systemd/system/
sudo systemctl daemon-reload
```

**Node version:** these run as root, whose PATH resolves `/usr/bin/node` (v20, shared with GNFS).
The scripts resolve `/opt/nodejs/22/bin/node` explicitly and the units set `PATH` to prefer it, so
the backup path runs on Node 22 — the AWS SDK requires `node >=22` for releases after January 2027.
Both degrade to PATH's `node` if `/opt/nodejs/22` is absent (e.g. after a rollback). Verify with:
```bash
sudo journalctl -u taskbuddy-backup.service -n 30 --no-pager | grep -i "NodeVersionSupportWarning" \
  && echo "still on Node 20" || echo "no version warning — running Node 22"
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
- **Coexists with GNFS** (node on `:3001`, DB `gnfs`, its own nginx vhosts). TaskBuddy uses
  ports 3100/3200 and a separate DB/role. Never edit GNFS's config.
- **No Redis** at launch (single instance).
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
| GNFS (`pm2-gnfs.service`) | active, serving on `:3001`, **0 restarts, up since 2026-07-08** |

GNFS's zero restarts across the 07-21 cutover is the evidence it was never disturbed. The frontend
unit carries no `ExecStart` override — it inherits Node 22 purely through
`Environment=PATH=/opt/nodejs/22/bin:…` and `next`'s `#!/usr/bin/env node` shebang; both units were
restarted at 00:27:05, after the drop-ins were written at 00:23:14, so the drop-ins are in effect.

Note: a bogus-credential login is **not** a valid `bcrypt` test — `AuthService.login` returns 401
before the compare when the email is unknown (`backend/src/services/auth.ts:134`). And never probe
child PINs: any failed attempt locks that child's account for 15 minutes (`auth.ts:219`).
