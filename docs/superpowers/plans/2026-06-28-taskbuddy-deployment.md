# TaskBuddy Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take TaskBuddy live: a Railway-hosted Next.js frontend + Express/Socket.io backend + managed Postgres, with R2 storage, Zoho ZeptoMail email, a real domain over HTTPS, monitoring, backups, and CI.

**Architecture:** Two interleaved tracks. **Track A (code/config)** makes the repo deploy-ready and is executed with the normal edit/commit cycle. **Track B (provisioning)** is dashboard/runbook work the human operator performs in Railway, Cloudflare, Zoho, Sentry, and UptimeRobot; each provisioning task lists exact steps and a verification check. Do Track A first (so deploys have something correct to run), then Track B in order.

**Tech Stack:** Railway (hosting + Postgres), Cloudflare (DNS + R2), Zoho ZeptoMail (SMTP), Sentry (errors), UptimeRobot (uptime), GitHub Actions (CI), Prisma, Next.js 16, Express, Socket.io.

## Global Constraints

- Owner/copyright: **Evolution Prime IT Ltd**.
- Single backend instance at launch: **no Redis** (do not provision it; remove it from required env).
- Backend is Express + Socket.io on `httpServer.listen(PORT)` - persistent, WebSocket-capable host only.
- Secrets NEVER committed; only `.env.example` (placeholders) goes in git. Real values live in Railway env vars.
- `app.<domain>` (frontend) and `api.<domain>` (backend) are different origins - auth cookies require `CROSS_ORIGIN_COOKIES=true` and CORS must allow the frontend origin.
- Migrations applied with `prisma migrate deploy` (13 migrations already exist in `backend/prisma/migrations`); never `db push` in production.
- Object storage must be R2 (`STORAGE_PROVIDER=r2`); Railway's filesystem is ephemeral.
- All shell commands run from repo root `C:/Users/CamaraSama/Projects/TaskBuddy` unless stated.
- `<domain>` placeholder = the domain registered in Task B1 (e.g. `taskbuddy.app`).

---

# TRACK A - Code / Config (executed in-repo)

### Task A1: Environment contract (`.env.example` files)

**Files:**
- Create: `backend/.env.example`
- Create: `frontend/.env.example`

**Interfaces:**
- Consumes: nothing
- Produces: the canonical list of env vars Track B pastes into Railway

- [ ] **Step 1: Create `backend/.env.example`**

```dotenv
# ---- Runtime ----
NODE_ENV=development
PORT=3001
API_URL=http://localhost:3001
# Comma-separated allowlist of frontend origins (CORS). Production: https://app.<domain>
CLIENT_URL=http://localhost:3000
# Base URL used to build links in emails. Production: https://app.<domain>
FRONTEND_URL=http://localhost:3000
# Set true in production because app.<domain> and api.<domain> are different origins
CROSS_ORIGIN_COOKIES=false

# ---- Database (required) ----
DATABASE_URL=postgresql://user:password@localhost:5432/taskbuddy

# ---- JWT (required - use long random strings) ----
JWT_SECRET=replace-with-long-random-string
JWT_REFRESH_SECRET=replace-with-different-long-random-string
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
JWT_CHILD_ACCESS_EXPIRES_IN=24h
JWT_CHILD_REFRESH_EXPIRES_IN=90d

# ---- Admin registration gate (required) ----
ADMIN_INVITE_CODE=replace-with-a-secret-code

# ---- Rate limiting ----
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ---- Invitations ----
INVITE_TOKEN_EXPIRES_HOURS=72

# ---- Storage: "local" for dev, "r2" for production ----
STORAGE_PROVIDER=local
UPLOADS_BASE_PATH=./uploads
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=taskbuddy-uploads
# Public base URL of the R2 bucket, no trailing slash, e.g. https://cdn.<domain>
R2_PUBLIC_URL=

# ---- Email (Zoho ZeptoMail SMTP in production) ----
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=TaskBuddy <no-reply@<domain>>

# ---- Web Push (VAPID) ----
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@<domain>

# ---- Error tracking (optional; leave blank to disable) ----
SENTRY_DSN=

# ---- Dev only: comma-separated ngrok tunnel origins ----
ALLOWED_NGROK_URL=
# Optional override for the recurring-task cron schedule
RECURRING_CRON_SCHEDULE=
```

- [ ] **Step 2: Create `frontend/.env.example`**

```dotenv
# Absolute API base in production so the browser hits the API subdomain directly.
# Local dev can leave this unset to use the Next.js /api rewrite.
NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1
# Target the Next.js rewrites proxy to (used when NEXT_PUBLIC_API_URL is relative)
BACKEND_URL=http://localhost:3001
# Web push public key (must equal backend VAPID_PUBLIC_KEY)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
# Error tracking (optional; leave blank to disable)
NEXT_PUBLIC_SENTRY_DSN=
```

- [ ] **Step 3: Verify both files exist and contain no real secrets**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
test -f backend/.env.example && test -f frontend/.env.example && echo "both exist"
grep -nE "=(.+secret.+|.+key.+)" backend/.env.example | grep -viE "replace-with|^.*=$|smtp_from|subject" || echo "no real secrets present"
```
Expected: `both exist`, then `no real secrets present`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add backend/.env.example frontend/.env.example
git commit -m "chore(config): add backend and frontend .env.example contracts

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: 2 files changed.

---

### Task A2: Remove Redis from production-required env

**Files:**
- Modify: `backend/src/config/index.ts:47-51`

**Interfaces:**
- Consumes: nothing
- Produces: `validateConfig()` that no longer demands `REDIS_URL` in production

- [ ] **Step 1: Edit the required-vars block**

Replace:
```ts
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'ADMIN_INVITE_CODE'];
  if (config.env === 'production') {
    required.push('REDIS_URL');
  }
```
with:
```ts
  // Single instance at launch: Redis is not required. Re-add REDIS_URL here only
  // when introducing the Socket.io Redis adapter for multi-instance scaling.
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'ADMIN_INVITE_CODE'];
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build:backend 2>&1 | tail -3
```
Expected: build succeeds (exit 0, no errors).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add backend/src/config/index.ts
git commit -m "fix(config): do not require REDIS_URL in production (single instance)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task A3: Health readiness + graceful shutdown

**Files:**
- Modify: `backend/src/index.ts` (the `/health` route at lines 130-133; append shutdown handlers before the final `export`)

**Interfaces:**
- Consumes: `prisma` from `./services/database`, `io` and `httpServer` already defined in `index.ts`
- Produces: `/health` returning DB status; SIGTERM/SIGINT graceful drain

- [ ] **Step 1: Add the prisma import**

At the top of `backend/src/index.ts`, immediately after the line
`import { seedGames } from './routes/gamesSeed';` add:
```ts
import { prisma } from './services/database';
```

- [ ] **Step 2: Replace the `/health` route with a readiness check**

Replace:
```ts
// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
```
with:
```ts
// Health + readiness check (verifies DB connectivity)
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});
```

- [ ] **Step 3: Append graceful shutdown before `export { app, httpServer };`**

Add immediately above the final `export { app, httpServer };` line:
```ts
// Graceful shutdown: stop accepting connections, drain Socket.io, disconnect Prisma.
function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received - draining connections...`);
  io.close(() => console.log('[shutdown] socket.io closed'));
  httpServer.close(async () => {
    await prisma.$disconnect();
    console.log('[shutdown] http server closed, prisma disconnected');
    process.exit(0);
  });
  // Failsafe: force-exit if drain hangs past 10s
  setTimeout(() => {
    console.error('[shutdown] drain timed out - forcing exit');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 4: Build, then smoke-test health locally**

Run (requires a local Postgres + `.env`; if none, just confirm the build):
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build:backend 2>&1 | tail -3
```
Expected: build succeeds. (If a local DB is configured, `node backend/dist/index.js` then `curl localhost:3001/health` returns `{"status":"ok","db":"up"}`.)

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add backend/src/index.ts
git commit -m "feat(ops): DB readiness check on /health and graceful shutdown

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task A4: Sentry on the backend

**Files:**
- Modify: `backend/package.json` (add dependency)
- Modify: `backend/src/index.ts` (init + error handler, both DSN-guarded)

**Interfaces:**
- Consumes: `SENTRY_DSN` env (optional - no-op when unset)
- Produces: backend error capture

- [ ] **Step 1: Install @sentry/node**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm install --save -w backend @sentry/node@^8
```
Expected: adds `@sentry/node` to `backend/package.json` dependencies.

- [ ] **Step 2: Initialise Sentry at the very top of `backend/src/index.ts`**

Make these the first two lines of the file (before all other imports):
```ts
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 3: Register the Sentry Express error handler**

In `backend/src/index.ts`, immediately BEFORE the `app.use(notFoundHandler);` line add:
```ts
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
```

- [ ] **Step 4: Build to verify**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build:backend 2>&1 | tail -3
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add backend/package.json package-lock.json backend/src/index.ts
git commit -m "feat(ops): add DSN-guarded Sentry error tracking to backend

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task A5: Sentry on the frontend

**Files:**
- Modify: `frontend/package.json` (add dependency)
- Create: `frontend/sentry.server.config.ts`
- Create: `frontend/sentry.edge.config.ts`
- Create: `frontend/instrumentation.ts`
- Create: `frontend/instrumentation-client.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SENTRY_DSN` env (optional - no-op when unset)
- Produces: frontend + server-component error capture

- [ ] **Step 1: Install @sentry/nextjs**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm install --save -w frontend @sentry/nextjs@^8
```

- [ ] **Step 2: Create `frontend/sentry.server.config.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 3: Create `frontend/sentry.edge.config.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 4: Create `frontend/instrumentation.ts`**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(...args: unknown[]) {
  const Sentry = await import('@sentry/nextjs');
  // @ts-expect-error - forward Next.js error args to Sentry's hook
  return Sentry.captureRequestError?.(...args);
}
```

- [ ] **Step 5: Create `frontend/instrumentation-client.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 6: Build to verify the instrumentation hooks compile**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build:frontend 2>&1 | tail -5
```
Expected: build succeeds (exit 0). If Next reports an unused `onRequestError` signature error, simplify it to `export const onRequestError = undefined;` is NOT allowed - instead keep the function; it is optional and Next tolerates extra exports.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add frontend/package.json package-lock.json frontend/sentry.server.config.ts frontend/sentry.edge.config.ts frontend/instrumentation.ts frontend/instrumentation-client.ts
git commit -m "feat(ops): add DSN-guarded Sentry error tracking to frontend

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task A6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the green `npm run lint` / `npm run build` pipeline
- Produces: PR status checks

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install dependencies
        run: npm ci
        env:
          # Skip the postinstall prisma generate failing the install if engines differ
          PRISMA_SKIP_POSTINSTALL_GENERATE: "false"
      - name: Generate Prisma client
        run: npm run db:generate
      - name: Lint
        run: npm run lint
      - name: Build
        run: npm run build
```

- [ ] **Step 2: Validate the workflow YAML locally**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('yaml file present and readable')"
```
Expected: `yaml file present and readable`. (Full validation happens when GitHub runs it.)

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions lint + build workflow

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

- [ ] **Step 4: Push and confirm the check runs**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git push origin main
```
Expected: on GitHub, the CI workflow appears under Actions and goes green. If `npm ci` fails because `package-lock.json` is out of sync after the Sentry installs, run `npm install` locally, commit the updated `package-lock.json`, and push again.

---

# TRACK B - Provisioning (operator runs in dashboards)

> These are runbook tasks. Exact button labels may shift as vendor UIs change; the env var names, DNS record values, and verification checks are authoritative. After each task, run the verification step.

### Task B1: Register domain + Cloudflare DNS

**Files:** none (external)

- [ ] **Step 1: Register a domain.** In Cloudflare (Dashboard > Domain Registration > Register Domains) or any registrar, buy a domain for TaskBuddy. If bought elsewhere, add the site under Cloudflare (Add a Site) and switch the registrar's nameservers to the two Cloudflare nameservers shown.
- [ ] **Step 2: Confirm Cloudflare is authoritative.** In Cloudflare the domain status must read **Active**.
- [ ] **Step 3: Record the chosen domain** as `<domain>` for all later tasks.
- [ ] **Step 4: Verify**

Run (replace `<domain>`):
```bash
nslookup -type=NS <domain>
```
Expected: the two `*.ns.cloudflare.com` nameservers are returned.

### Task B2: Railway project + Postgres + backend service

**Files:** none (external) - uses the repo's GitHub connection

- [ ] **Step 1:** Create a Railway account and a **New Project** > **Deploy from GitHub repo** > select the TaskBuddy repo.
- [ ] **Step 2:** Add a database: **New** > **Database** > **PostgreSQL**. Railway provisions it and exposes `DATABASE_URL` as a shared variable.
- [ ] **Step 3:** Configure the **backend** service settings:
  - Root directory: repo root.
  - Build command: `npm ci && npm run db:generate && npm run build:backend`
  - Start command: `npm -w backend run start`
  - Health check path: `/health`
- [ ] **Step 4:** Add backend env vars (Variables tab). Reference `${{Postgres.DATABASE_URL}}` for the DB. Set every required var from `backend/.env.example` with REAL values:
  - `NODE_ENV=production`, `PORT=3001`
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `JWT_SECRET`, `JWT_REFRESH_SECRET` - generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (run twice, different values)
  - `ADMIN_INVITE_CODE` - a secret string
  - `CROSS_ORIGIN_COOKIES=true`
  - `CLIENT_URL=https://app.<domain>`, `FRONTEND_URL=https://app.<domain>`, `API_URL=https://api.<domain>`
  - (R2, SMTP, VAPID, SENTRY_DSN added in their own tasks below)
- [ ] **Step 5:** Run migrations against the Railway DB. Either set the backend build command to include `npm -w backend run db:migrate:prod` once, OR from a local shell with the Railway `DATABASE_URL`:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy/backend"
DATABASE_URL="<railway-postgres-public-url>" npx prisma migrate deploy
```
- [ ] **Step 6: Verify**

Run (after first deploy, using the temporary Railway-generated backend URL):
```bash
curl -s https://<railway-backend-subdomain>.up.railway.app/health
```
Expected: `{"status":"ok","db":"up"}`.

### Task B3: Cloudflare R2 storage

**Files:** none (external)

- [ ] **Step 1:** Cloudflare Dashboard > **R2** > **Create bucket** named `taskbuddy-uploads`.
- [ ] **Step 2:** Enable a public access URL for the bucket: either connect a custom subdomain `cdn.<domain>` (R2 > bucket > Settings > Custom Domains) or enable the r2.dev public URL. Note the public base URL.
- [ ] **Step 3:** Enable **Object versioning** (bucket Settings) for accidental-delete protection.
- [ ] **Step 4:** Create an **R2 API token** (R2 > Manage API Tokens > Create) scoped to Object Read & Write for this bucket. Record the Access Key ID, Secret Access Key, and your Account ID.
- [ ] **Step 5:** Add these backend env vars in Railway:
  - `STORAGE_PROVIDER=r2`
  - `R2_ACCOUNT_ID=<account id>`
  - `R2_ACCESS_KEY_ID=<access key id>`
  - `R2_SECRET_ACCESS_KEY=<secret>`
  - `R2_BUCKET_NAME=taskbuddy-uploads`
  - `R2_PUBLIC_URL=https://cdn.<domain>` (no trailing slash)
- [ ] **Step 6: Verify** (after redeploy): in the running app, submit a task with a photo as a child, approve it, then redeploy the backend in Railway and confirm the photo still loads (proves storage is off the ephemeral filesystem). The image URL should be on the R2/`cdn.<domain>` host.

### Task B4: Zoho ZeptoMail + DNS authentication

**Files:** none (external)

- [ ] **Step 1:** Create a Zoho account and open **ZeptoMail**. Add and verify `<domain>` as a sending domain.
- [ ] **Step 2:** Add the **SPF, DKIM, and DMARC** DNS records ZeptoMail provides as records in Cloudflare DNS (Type/Name/Value exactly as shown). Wait for ZeptoMail to mark the domain **Verified**.
- [ ] **Step 3:** Create a **Mail Agent** and generate **SMTP credentials**. ZeptoMail SMTP host is `smtp.zeptomail.com`, port `587` (or `465`), username typically `emailapikey`, password = the generated send-mail token.
- [ ] **Step 4:** Add these backend env vars in Railway:
  - `SMTP_HOST=smtp.zeptomail.com`
  - `SMTP_PORT=465`
  - `SMTP_USER=emailapikey`
  - `SMTP_PASS=<zeptomail send token>`
  - `SMTP_FROM=TaskBuddy <no-reply@<domain>>`
- [ ] **Step 5: Verify:** trigger a real email from the app (e.g. register a parent / send a co-parent invite) and confirm it arrives in an inbox (not spam). Check ZeptoMail's dashboard shows the send as delivered.

### Task B5: Frontend service + custom domains + TLS

**Files:** none (external)

- [ ] **Step 1:** In the Railway project add a second service from the same repo for the **frontend**:
  - Build command: `npm ci && npm run build:frontend`
  - Start command: `npm -w frontend run start`
- [ ] **Step 2:** Frontend env vars:
  - `NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1`
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same as backend VAPID_PUBLIC_KEY>`
  - `NEXT_PUBLIC_SENTRY_DSN=<frontend Sentry DSN from Task B6>`
  - `BACKEND_URL=https://api.<domain>`
- [ ] **Step 3:** Generate VAPID keys once and set on BOTH services:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npx web-push generate-vapid-keys
```
Set backend `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT=mailto:support@<domain>` and frontend `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (= the public key).
- [ ] **Step 4:** Add custom domains (Railway service > Settings > Networking > Custom Domain): `api.<domain>` on the backend service, `app.<domain>` on the frontend service. Railway shows a CNAME target for each.
- [ ] **Step 5:** In Cloudflare DNS add the two **CNAME** records Railway specifies (`api` and `app` -> the Railway targets). Set them to **DNS only** (grey cloud) initially so Railway can issue TLS; you may enable proxying later.
- [ ] **Step 6: Verify**

Run:
```bash
curl -s https://api.<domain>/health
```
Expected: `{"status":"ok","db":"up"}` over valid HTTPS. Then open `https://app.<domain>` in a browser, register, and confirm the dashboard loads and real-time updates work (Socket.io connects to `api.<domain>`).

### Task B6: Sentry project + DSNs

**Files:** none (external)

- [ ] **Step 1:** Create a Sentry account. Create two projects: a **Node** project (backend) and a **Next.js** project (frontend). Copy each project's DSN.
- [ ] **Step 2:** Set `SENTRY_DSN=<node dsn>` on the Railway backend service and `NEXT_PUBLIC_SENTRY_DSN=<nextjs dsn>` on the frontend service. Redeploy both.
- [ ] **Step 3: Verify:** trigger a deliberate error (e.g. hit a non-existent API route that throws, or use Sentry's test button) and confirm the event appears in the corresponding Sentry project within a minute.

### Task B7: UptimeRobot monitoring

**Files:** none (external)

- [ ] **Step 1:** Create an UptimeRobot account. Add a new **HTTP(s)** monitor for `https://api.<domain>/health`, interval 5 minutes, alert contact = your email.
- [ ] **Step 2:** Add a second monitor for `https://app.<domain>`.
- [ ] **Step 3: Verify:** both monitors report **Up**. Optionally pause the backend service briefly to confirm a down-alert email arrives, then resume.

### Task B8: Final go-live verification

**Files:** none

- [ ] **Step 1:** Confirm Railway Postgres **automated backups** are enabled (Postgres service > Backups). Note the schedule/retention.
- [ ] **Step 2:** End-to-end smoke test on production: register a parent, create a child, assign a task, submit it with a photo (child), approve it (parent), redeem a reward, and confirm a notification email arrived. Photos load from R2; real-time toasts fire.
- [ ] **Step 3:** Confirm CORS is locked: from a browser console on an unrelated site, a `fetch('https://api.<domain>/api/v1/...')` with credentials should be blocked by CORS (origin not allowlisted).

---

## Self-Review

**Spec coverage** (against `2026-06-28-taskbuddy-deployment-design.md`):
- Hosting Railway all-in-one (sec 6) -> B2, B5. PASS
- Database managed + migrate deploy + backups (sec 7) -> B2 (migrate), B8 (backups). 13 migrations already exist; no initial-migration task needed. PASS
- Object storage R2 + versioning (sec 8) -> B3; `.env.example` storage vars A1. PASS
- Email ZeptoMail + SPF/DKIM/DMARC (sec 9) -> B4. PASS
- Domain/DNS/HTTPS (sec 10) -> B1, B5. PASS
- Config & secrets, `.env.example`, Redis omitted (sec 11) -> A1, A2. PASS
- Monitoring/error/health/graceful shutdown (sec 12) -> A3 (health+shutdown), A4/A5 (Sentry), B6, B7. PASS
- CI/CD (sec 13) -> A6; deploy via Railway GitHub integration B2/B5; migrate-on-release B2 Step 5. PASS
- Launch-blocking security (sec 14): helmet, rate limiting, CORS lockdown ALREADY EXIST in `backend/src/index.ts` (verified) -> covered by B8 Step 3 (CORS) and existing code; secret rotation handled by generating fresh JWT secrets in B2 Step 4. Note added below. PASS

**Note on security subset:** The spec listed helmet + rate limiting as work, but the backend already implements both (`helmet(...)` and two `express-rate-limit` limiters in `index.ts`), so no task adds them; the plan instead verifies CORS lockdown (B8) and rotates secrets (B2). This avoids duplicate work.

**Placeholder scan:** `<domain>`, `<railway-...>`, `<account id>`, `<... dsn>` are operator-supplied runtime values in external-provisioning steps, not plan placeholders; each is defined in Global Constraints or the step that produces it. All in-repo code steps contain complete content. PASS.

**Type/name consistency:** env var names match `backend/src/config/index.ts` and the greps (`CLIENT_URL`, `FRONTEND_URL`, `CROSS_ORIGIN_COOKIES`, `STORAGE_PROVIDER`, `R2_*`, `SMTP_*`, `VAPID_*`, `SENTRY_DSN`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `BACKEND_URL`). `prisma`, `io`, `httpServer` symbols used in A3 exist in `index.ts`. PASS.
