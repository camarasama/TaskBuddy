# TaskBuddy Deployment / Production Infrastructure Design

**Date:** 2026-06-28
**Owner / Copyright Holder:** Evolution Prime IT Ltd
**Status:** Approved (design phase)
**Depends on:** [2026-06-25-taskbuddy-commercialization-design.md](2026-06-25-taskbuddy-commercialization-design.md)

## 1. Purpose

Take TaskBuddy from a locally-runnable codebase to a live, publicly reachable
production service on web, so it can have an online presence and (in a later
build-out) generate revenue. This covers hosting, database, storage, email,
domain/TLS, secrets, monitoring, backups, CI/CD, and a launch-blocking security
subset.

## 2. Goals

- TaskBuddy reachable at a real domain over HTTPS, always-on (no cold starts).
- Managed PostgreSQL with versioned migrations and automated backups.
- Persistent object storage for photo evidence and avatars (off the ephemeral
  app filesystem).
- Production-grade transactional email with proper DNS authentication.
- Secrets stored outside git; documented env contract.
- Error tracking, uptime monitoring, and graceful deploys.
- Automated CI (lint + build) and Git-push deploys with migration on release.

## 3. Non-Goals

- Billing / subscriptions (separate spec).
- Capacitor mobile apps (separate spec).
- A full automated test suite (separate effort; CI will run what exists).
- Horizontal scaling / multi-instance Socket.io (single instance at launch).
- Deep security remediation beyond the launch-blocking subset in section 12.

## 4. Constraints (from the codebase)

- Backend is **Express + Socket.io** on `httpServer.listen(PORT)` -> requires a
  persistent, WebSocket-capable host (NOT serverless).
- Frontend is **Next.js 16** (`next build --webpack`) with next-pwa; proxies
  `/api` and `/uploads` to `BACKEND_URL` via rewrites; CORS gated by `CLIENT_URL`.
- Storage is pluggable via `STORAGE_PROVIDER` (`local` | `r2`); R2 config block
  already exists in `backend/src/config/index.ts`.
- Email uses `nodemailer` via `createTransport()` -> any SMTP provider works
  with config-only changes.
- `REDIS_URL` is referenced in config but not required for a single instance.

## 5. Target Architecture

```
                      Cloudflare DNS + TLS
                              |
        +---------------------+---------------------+
        |                                           |
  app.<domain>                               api.<domain>
  (Next.js frontend)  -- /api proxy / CORS --> (Express + Socket.io)
   Railway service                            Railway service
                                                   |
                          +------------------------+----------------+
                     Railway Postgres        Cloudflare R2     Zoho ZeptoMail
                     (managed + backups)     (evidence/avatars) (transactional SMTP)
```

## 6. Hosting: Railway (all-in-one)

One Railway project, three services:
- **backend** - Node web service running the Express + Socket.io server.
  WebSockets supported. Start command `npm -w backend run start` against the
  built `dist/`.
- **frontend** - Next.js service. Build `npm -w frontend run build`, start
  `npm -w frontend run start`.
- **Postgres** - Railway managed Postgres plugin.

Rationale: single dashboard, Git-push deploys, internal networking between API
and DB, WebSocket support, fits the ~$20-40/mo budget. Render is an equivalent
fallback. A Vercel frontend split is deferred (adds a platform and cross-origin
Socket.io complexity); moving the frontend to Vercel later is non-breaking.

## 7. Database

- Railway managed **PostgreSQL**; `DATABASE_URL` injected via Railway.
- Schema applied with `prisma migrate deploy` as a release step (versioned,
  repeatable) - NOT `db push`.
- **Automated daily backups** enabled with retention; document on-demand
  `pg_dump` snapshot procedure.
- Confirm a baseline migration exists in `backend/prisma/migrations`; if the
  project has only used `db push`, generate an initial migration before first
  deploy.

## 8. Object Storage

- Set `STORAGE_PROVIDER=r2`.
- Create Cloudflare R2 bucket + scoped API token; populate the `r2` config block
  (account id, access key id, secret, bucket name, public base URL).
- Enable bucket **versioning** for accidental-delete protection.
- Required because Railway's filesystem is ephemeral: `local` storage would lose
  uploaded photos/avatars on every redeploy.

## 9. Email (Zoho ZeptoMail)

- Use **ZeptoMail** (Zoho's transactional service) via SMTP credentials; reuse
  the existing `nodemailer` transport (host/port/user/pass config only).
- Configure **SPF, DKIM, and DMARC** DNS records for the domain.
- Set `FRONTEND_URL` so the email templates' deep links resolve to production.
- Optional Zoho Mail mailboxes for the human `support@` / `privacy@` addresses
  referenced in TERMS.md / PRIVACY.md.

## 10. Domain, DNS, HTTPS

- Register a domain (candidate names proposed at implementation time).
- Host DNS on **Cloudflare**.
- Map `app.<domain>` -> frontend service and `api.<domain>` -> backend service
  as Railway custom domains.
- Railway issues and auto-renews **TLS certificates**.
- Update `CLIENT_URL` (CORS allowlist), `FRONTEND_URL`, `API_URL`, and the
  frontend `BACKEND_URL` rewrite target to the production URLs.

## 11. Configuration & Secrets

- Add committed **`backend/.env.example`** and **`frontend/.env.example`**
  documenting every required variable with placeholder (non-secret) values.
  (None exist today - a real gap.)
- All real secrets live in **Railway env vars**, never in git: `DATABASE_URL`,
  `JWT_SECRET` + refresh secret (freshly generated long random strings), R2
  credentials, ZeptoMail credentials, `CLIENT_URL`/`FRONTEND_URL`/`API_URL`,
  admin registration gate, `NODE_ENV=production`.
- `REDIS_URL` intentionally omitted at launch (single instance; YAGNI until the
  Socket.io Redis adapter is needed for multi-instance scaling).

## 12. Monitoring, Error Tracking, Health

- **Sentry** on backend and frontend (error capture + release tracking).
- **Uptime monitoring** (UptimeRobot or Better Uptime) against `/health` with
  alerting.
- Add a **readiness check** that verifies DB connectivity, and **graceful
  shutdown** handling so deploys drain in-flight Socket.io connections instead
  of dropping them.
- Railway logs/metrics used for live debugging.

## 13. CI/CD

- **GitHub Actions** on PR: `npm ci` -> `npm run lint` -> `npm run build` ->
  typecheck. (The pipeline is currently green.)
- On merge to `main`: Railway GitHub integration auto-deploys both services; a
  release step runs `prisma migrate deploy`.
- Separate **staging** environment deferred unless budget moves to a higher tier.

## 14. Launch-blocking Security Subset

Action the relevant items from `do_not_upload/security_assessment.md`:
- Add `helmet` security headers.
- Add **rate limiting** to auth and other sensitive routes.
- Confirm CORS is locked to the production origins only.
- Rotate all secrets away from any development values.
- Review the localStorage child-refresh-token strategy for production
  acceptability.

Deeper security remediation may follow as its own pass.

## 15. Deliverables of the Implementation Phase

1. `backend/.env.example` and `frontend/.env.example`.
2. Railway project with backend, frontend, and Postgres services configured.
3. Production start scripts verified (`start` for both workspaces).
4. R2 storage enabled and verified (upload persists across redeploy).
5. ZeptoMail SMTP configured; SPF/DKIM/DMARC records set; test email delivered.
6. Domain registered, Cloudflare DNS, custom domains + TLS on Railway.
7. Initial Prisma migration (if missing) + `migrate deploy` release step.
8. Sentry + uptime monitoring + `/health` readiness + graceful shutdown.
9. GitHub Actions CI workflow.
10. Helmet + rate limiting + CORS lockdown + rotated secrets.

## 16. Open Questions

None outstanding. Decisions captured: Railway all-in-one hosting; budget
~$20-40/mo; domain to be registered (none yet); Cloudflare DNS; Cloudflare R2
storage; Zoho ZeptoMail email; Sentry + UptimeRobot monitoring; single instance
(no Redis) at launch.
