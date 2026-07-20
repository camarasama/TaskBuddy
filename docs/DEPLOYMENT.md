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

The `.env` files are `chmod 600` owned by `taskbuddy`, so run manual scripts that read them as
`sudo -u taskbuddy` (otherwise `dotenv` silently skips the unreadable file).

## Deploy / update

```bash
cd /opt/taskbuddy/app
sudo -u taskbuddy git pull
sudo -u taskbuddy npm ci                    # only if dependencies changed
sudo -u taskbuddy npm run build:backend     # after backend changes
sudo -u taskbuddy npm run build:frontend    # after frontend changes OR any NEXT_PUBLIC_* change
sudo systemctl restart taskbuddy-backend
sudo systemctl restart taskbuddy-frontend
```

Health check: `curl -s https://api.gettaskbuddy.com/health` → `{"status":"ok","db":"up"}`.

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

Install / operate:
```bash
sudo cp deploy/systemd/taskbuddy-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now taskbuddy-backup.timer
sudo systemctl start taskbuddy-backup.service     # run one now
systemctl list-timers taskbuddy-backup.timer      # next scheduled run
```
Restore (into a scratch DB to verify): `gunzip -c taskbuddy-<ts>.sql.gz | psql <target-db>`.

## Gotchas

- **Coexists with GNFS** (node on `:3001`, DB `gnfs`, its own nginx vhosts). TaskBuddy uses
  ports 3100/3200 and a separate DB/role. Never edit GNFS's config.
- **No Redis** at launch (single instance).
- **Shared package** (`@taskbuddy/shared`) must resolve to its compiled `dist/` at runtime
  (its `package.json` exports point there); `node dist/index.js` cannot run the TS source.
- Backend must `trust proxy` in production (set) so rate limiting keys on the real client IP.

## Pending / TODO

- UptimeRobot monitors on `/health` and `app.gettaskbuddy.com`.
- Marketing page on the apex `gettaskbuddy.com` (currently a placeholder).
- Rotate any secret that passed through a chat/transcript before public launch.
- Bump the VPS to Node 22 LTS before Jan 2027 (AWS SDK v3 will require it).
