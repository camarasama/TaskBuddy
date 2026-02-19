# TaskBuddy

> **End-of-Programme Project — BSc Information Technology**
> Regional Maritime University, Ghana · February 2026
> **Student:** Souleymane Camara

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features](#2-key-features)
3. [Technology Stack](#3-technology-stack)
4. [System Architecture](#4-system-architecture)
5. [Database Schema](#5-database-schema)
6. [API Reference](#6-api-reference)
7. [Getting Started](#7-getting-started)
8. [Environment Variables](#8-environment-variables)
9. [Project Structure](#9-project-structure)
10. [Development Roadmap](#10-development-roadmap)
11. [Testing](#11-testing)
12. [Deployment](#12-deployment)
13. [Academic Context](#13-academic-context)

---

## 1. Project Overview

TaskBuddy is a **family task management Progressive Web Application (PWA)** designed to help parents assign, track, and reward household tasks for children aged 10–16. The application uses gamification mechanics — experience points (XP), a points currency, level progression, streaks, and achievements — to motivate children to complete tasks consistently.

### The Problem

Many families struggle with chore compliance. Verbal reminders are forgotten, physical chore charts fall out of date, and generic to-do apps lack the engagement features needed to motivate children. Parents also have no visibility into task history, completion rates, or which children are falling behind.

### The Solution

TaskBuddy provides:
- A **parent dashboard** for creating and assigning tasks, approving completions, and managing rewards
- A **child dashboard** with a game-like interface showing XP, levels, streaks, and pending rewards
- A **dual-currency system** (XP for levelling up, Points for spending on rewards) to decouple progression from purchasing
- **Multi-parent support** so spouses, co-parents, and guardians share full management access
- **Photo evidence submission** so children prove task completion before points are awarded
- **Memorable family codes** (e.g. `MEGA-VIPER-8481`) for children to log in without email addresses
- **Reward caps** — per-child and household-wide redemption limits with optional expiry dates
- **Email notifications** — automated emails for task events, reward redemptions, level-ups, and streak reminders

---

## 2. Key Features

### For Parents
| Feature | Description |
|---|---|
| Family registration | Create a family account with a unique memorable code |
| Co-parent invite | Invite a spouse, partner, guardian, or other adult via email link |
| Task management | Create, assign, edit, and archive tasks with difficulty ratings and primary/secondary tags |
| Approval workflow | Review photo evidence and approve or reject completions |
| Reward catalogue | Create redeemable rewards with point costs, per-child limits, household caps, and expiry dates |
| Family code management | Regenerate the family login code at any time |
| Email notifications | Receive emails for task submissions, approvals, reward redemptions, level-ups, and streak alerts |
| Notification preferences | Toggle each email type on/off per family from the Settings page |
| Settings | Configure grace periods, leaderboard visibility, auto-approve rules |

### For Children
| Feature | Description |
|---|---|
| PIN + family code login | Log in with a memorable code and a 4-digit PIN — no email needed |
| Persistent sessions | Stay logged in across browser closes (via localStorage) |
| Task dashboard | See primary and secondary tasks separately — secondary tasks unlock when primary is done |
| Photo evidence | Upload proof of completion directly from the task card |
| XP & levelling | Earn XP to unlock new levels (cosmetic progression, cannot be spent) |
| Points & rewards | Earn points to redeem against parent-created rewards |
| Streak tracking | Daily streak counter with configurable grace periods |
| Achievements | Unlock badges for milestones |
| Reward shop | See live cap status — "Sold Out" and "Expired" rewards are clearly labelled |

### Platform
- **PWA** — installable on Android, iOS, and desktop
- **Mobile-first** responsive design
- Works over ngrok for remote testing and demonstration

---

## 3. Technology Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Next.js | 14 | React framework, App Router, SSR/CSR |
| TypeScript | 5 | Type safety across the entire codebase |
| Tailwind CSS | 3 | Utility-first styling |
| Framer Motion | — | Page and component animations |
| React Hook Form + Zod | — | Form handling and validation |
| Lucide React | — | Icon library |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js + Express | 20 / 4 | REST API server |
| TypeScript | 5 | Type-safe backend code |
| Prisma ORM | 5 | Database access and migrations |
| PostgreSQL | 15 | Primary relational database |
| JSON Web Tokens | — | Access + refresh token authentication |
| bcrypt | — | Password hashing |
| Nodemailer | — | Transactional email (all notification triggers) |
| Multer + Sharp | — | File upload handling and thumbnail generation |
| node-cron | — | Scheduled jobs (expiry warnings, streak-at-risk alerts) |
| Zod | — | Request validation schemas |

### Infrastructure & Storage
| Technology | Purpose |
|---|---|
| Cloudflare R2 | Production file/image storage |
| Local filesystem | Development file storage |
| ngrok | Remote tunnelling for testing |

### Shared
| Package | Purpose |
|---|---|
| `@taskbuddy/shared` | TypeScript types, constants, and validation rules shared between frontend and backend |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client                              │
│              Next.js PWA (localhost:3000)                   │
│                                                             │
│   Parent Dashboard  │  Child Dashboard  │  Auth Pages       │
│   Settings / Invite │  Task Cards       │  /invite/accept   │
│   Admin Dashboard   │  Email Log Viewer │                   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / REST
                               │ JWT Bearer Token (Authorization header)
                               │ Refresh Token (httpOnly cookie)
┌──────────────────────────────▼──────────────────────────────┐
│                       Backend API                           │
│              Express + TypeScript (localhost:3001)          │
│                                                             │
│  /auth/*     /families/*     /tasks/*     /rewards/*        │
│  /children/* /dashboard/*    /uploads/*   /admin/*          │
│                                                             │
│  Middleware: authenticate → requireParent / requireChild    │
│  Validation: Zod schemas on all request bodies              │
│  Scheduler:  node-cron jobs (expiry, streak-at-risk)        │
│  EmailService: Nodemailer + SMTP retry + email_logs         │
└─────────────┬────────────────────────────┬──────────────────┘
              │ Prisma ORM                  │ Multer → StorageService
              │                             │
┌─────────────▼──────────┐    ┌────────────▼──────────────────┐
│      PostgreSQL         │    │   File Storage                │
│   (taskbuddy database)  │    │   Dev:  ./uploads/            │
│                         │    │   Prod: Cloudflare R2         │
└─────────────────────────┘    └───────────────────────────────┘
```

### Authentication Flow

```
Parent login:
  POST /auth/login → accessToken (15m) + refreshToken cookie (7d)
  accessToken stored in sessionStorage (clears on browser close)

Child login:
  POST /auth/child/login → accessToken (24h) + refreshToken cookie (90d)
  accessToken stored in localStorage (persists across browser closes)

Co-parent invite:
  POST /families/me/invite → creates FamilyInvitation record + sends email
  GET  /auth/invite-preview?token= → public preview (family name, inviter)
  POST /auth/accept-invite → creates User, marks invitation accepted, returns JWT
```

---

## 5. Database Schema

### Core Tables

```
families
  id, familyName, familyCode (ADJECTIVE-ANIMAL-NNNN), createdAt
  isSuspended, suspendedAt, suspendedBy                ← M8 admin controls

users
  id, familyId, email, username, passwordHash, role (parent|child|admin)
  firstName, lastName, avatarUrl, isPrimaryParent
  dateOfBirth, phone, isActive, lastLoginAt, deletedAt

child_profiles
  id, userId, dateOfBirth, ageGroup (10-12|13-16)
  pointsBalance, totalPointsEarned, totalTasksCompleted
  currentStreakDays, longestStreakDays, lastStreakDate
  level, experiencePoints, totalXpEarned  ← lifetime XP accumulator (M7)
  pinHash

family_invitations
  id, familyId, invitedByUserId, email, token (unique)
  expiresAt, acceptedAt, createdAt

tasks
  id, familyId, createdBy, title, description, category
  difficulty (easy|medium|hard), pointsValue
  taskTag (primary|secondary)              ← M5
  startTime, estimatedMinutes              ← M5 overlap detection
  dueDate, requiresPhotoEvidence, isRecurring, recurrencePattern
  autoApprove, status (active|paused|archived)

task_assignments
  id, taskId, childId, instanceDate, status
  (pending|in_progress|completed|approved|rejected)
  completedAt, approvedAt, approvedBy, rejectionReason
  pointsAwarded, xpAwarded
  emailSentAt                              ← M9: expiry cron deduplication guard

task_evidence
  id, assignmentId, uploadedBy, fileUrl, thumbnailUrl
  fileType, fileSizeBytes, createdAt

rewards
  id, familyId, createdBy, name, description
  pointsCost, tier (small|medium|large)
  maxRedemptionsPerChild                   ← per-child claim cap
  maxRedemptionsTotal                      ← household-wide claim cap (M6)
  expiresAt                                ← auto-locks after this datetime (M6)
  isActive, isCollaborative, deletedAt

reward_redemptions
  id, rewardId, childId, approvedBy
  status (pending|approved|fulfilled|cancelled)
  pointsSpent, createdAt

points_ledger
  id, childId, transactionType (earned|redeemed|bonus|penalty|adjustment|milestone_bonus)
  pointsAmount, balanceAfter, description
  referenceType, referenceId, createdBy, createdAt

achievements / child_achievements
  Definitions + unlock records per child

audit_logs                                 ← M8: immutable mutation log
  id, actorId, action, resourceType, resourceId
  familyId, metadata (JSON), ipAddress, createdAt

email_logs                                 ← M9: email delivery audit trail
  id, toEmail, toUserId, familyId
  triggerType, subject, status (sent|failed|bounced)
  errorMessage, referenceType, referenceId
  resendCount, lastResentAt, createdAt

family_settings
  notificationPreferences (JSON)           ← M9: per-family email opt-in/out
  autoApproveRecurringTasks, enableDailyChallenges
  enableLeaderboard, streakGracePeriodHours
```

### Key Migrations (in order)
```
init_schema                  — all base tables
add_memorable_family_code    — families.familyCode
add_co_parent_support        — users.isPrimaryParent + family_invitations
add_user_dob_phone           — users.dateOfBirth + users.phone
add_task_tag_and_schedule    — tasks.taskTag + tasks.startTime/estimatedMinutes (M5)
add_reward_total_cap         — rewards.maxRedemptionsTotal (M6)
m7_xp_dual_currency          — child_profiles.totalXpEarned + TransactionType.milestone_bonus (M7)
m8_admin_audit               — audit_logs + families.isSuspended (M8)
add_email_logs               — email_logs + task_assignments.emailSentAt + EmailLogStatus enum (M9)
add_email_log_relations      — EmailLog relations to User and Family (M9)
```

---

## 6. API Reference

### Authentication
```
POST   /api/v1/auth/register           Register family + primary parent
POST   /api/v1/auth/login              Parent email/password login
POST   /api/v1/auth/child/login        Child login (familyCode + username + PIN)
POST   /api/v1/auth/logout             Invalidate refresh token
POST   /api/v1/auth/refresh            Refresh access token
GET    /api/v1/auth/me                 Get current user
PUT    /api/v1/auth/password           Change password
GET    /api/v1/auth/invite-preview     Preview invite (public, token query param)
POST   /api/v1/auth/accept-invite      Accept invite and create co-parent account
POST   /api/v1/auth/admin/register     Register admin account (requires ADMIN_INVITE_CODE)
```

### Families
```
GET    /api/v1/families/me             Get family info
PUT    /api/v1/families/me             Update family name
GET    /api/v1/families/me/settings    Get gamification + notification settings
PUT    /api/v1/families/me/settings    Update settings (incl. notificationPreferences)
GET    /api/v1/families/me/members     All family members (parents + children)
POST   /api/v1/families/me/children    Add a child
GET    /api/v1/families/me/children/:id
PUT    /api/v1/families/me/children/:id
DELETE /api/v1/families/me/children/:id
GET    /api/v1/families/me/parents     List parent accounts + pending invites
POST   /api/v1/families/me/invite      Send co-parent invite email
DELETE /api/v1/families/me/parents/:id          Remove co-parent
DELETE /api/v1/families/me/invitations/:id      Cancel pending invite
```

### Tasks
```
GET    /api/v1/tasks                   List tasks (filterable by tag, status, child)
POST   /api/v1/tasks                   Create task + assignments
GET    /api/v1/tasks/:id
PUT    /api/v1/tasks/:id
DELETE /api/v1/tasks/:id
GET    /api/v1/tasks/:id/assignments   List assignments for a task
POST   /api/v1/tasks/:id/complete      Child marks task complete + uploads evidence
PUT    /api/v1/tasks/:id/approve       Parent approves/rejects completion
```

### Rewards
```
GET    /api/v1/rewards                 List rewards (includes computed cap fields)
POST   /api/v1/rewards                 Create reward (supports maxRedemptionsTotal, expiresAt)
GET    /api/v1/rewards/:id             Get reward + computed cap status
PUT    /api/v1/rewards/:id             Update reward
DELETE /api/v1/rewards/:id             Soft delete reward
POST   /api/v1/rewards/:id/redeem      Child redeems reward (three-gate cap check)
GET    /api/v1/rewards/redemptions/history
PUT    /api/v1/rewards/redemptions/:id/fulfill   Parent fulfils redemption
PUT    /api/v1/rewards/redemptions/:id/cancel    Cancel + refund points
```

**Computed fields on reward responses (M6):**
```
totalRedemptionsUsed   — non-cancelled claims across the household
remainingTotal         — household claims left (null = no cap)
remainingForChild      — claims left for requesting child (null = no cap)
isExpired              — true when expiresAt is set and in the past
isSoldOut              — true when totalRedemptionsUsed >= maxRedemptionsTotal
```

### Dashboard & Uploads
```
GET    /api/v1/dashboard/parent        Parent summary (family, parents, children, weeklyStats)
GET    /api/v1/dashboard/child         Child summary + today's tasks
GET    /api/v1/dashboard/points/:id    Points history for a child
GET    /api/v1/dashboard/leaderboard   Family leaderboard (if enabled)
POST   /api/v1/uploads/evidence        Upload task evidence photo (multipart)
GET    /api/v1/uploads/:filename       Serve uploaded file
```

### Admin (M8)
```
POST   /api/v1/admin/register          Register admin account
GET    /api/v1/admin/overview          Platform health stats
GET    /api/v1/admin/families          Paginated family list with search
GET    /api/v1/admin/families/:id      Family detail view
PUT    /api/v1/admin/families/:id/suspend     Suspend a family
PUT    /api/v1/admin/families/:id/reactivate  Reactivate a family
GET    /api/v1/admin/users             Cross-family user search
GET    /api/v1/admin/audit-log         Paginated audit log with filters
GET    /api/v1/admin/achievements      List all achievements
POST   /api/v1/admin/achievements      Create achievement
PUT    /api/v1/admin/achievements/:id  Update achievement
DELETE /api/v1/admin/achievements/:id  Delete achievement
```

### Email Logs (M9)
```
GET    /api/v1/admin/emails            Paginated email_logs (filter by status, type, family)
POST   /api/v1/admin/emails/:id/resend Re-send a failed email
```

---

## 7. Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 9+
- **PostgreSQL** 15+
- **Git**

### 1. Clone the repository

```bash
git clone https://github.com/your-username/task-buddy.git
cd task-buddy
```

### 2. Install all dependencies

```bash
npm install
```

This installs dependencies for the root workspace, `frontend/`, `backend/`, and `shared/` packages via npm workspaces.

### 3. Set up the database

```bash
# Create the PostgreSQL database
createdb taskbuddy
```

### 4. Configure the backend environment

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` — at minimum set `DATABASE_URL` and `SMTP_*` variables. See [Environment Variables](#8-environment-variables) for the full reference.

### 5. Run database migrations

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

Or from the root:
```bash
npm run db:migrate
```

### 6. Start the application

```bash
# From root — starts both frontend and backend concurrently
npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |

### 7. Seed the database (optional)

```bash
npm run db:seed
```

Creates a sample family with one parent, two children, sample tasks, and rewards.

### Remote Testing via ngrok

To share the app with testers outside your local network:

```bash
# Terminal 1 — expose the frontend
ngrok http 3000

# Terminal 2 — expose the backend (if needed separately)
ngrok http 3001
```

Then set in `backend/.env`:
```dotenv
CLIENT_URL=https://xxxx.ngrok-free.app
FRONTEND_URL=https://xxxx.ngrok-free.app
```

And in `frontend/.env.local`:
```dotenv
NEXT_PUBLIC_API_URL=https://xxxx.ngrok-free.app/api/v1
```

Restart both services. Invite links and all notification emails will now point to the ngrok URL and work for external testers.

---

## 8. Environment Variables

### Backend (`backend/.env`)

```dotenv
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/taskbuddy

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development

# ── CORS — comma-separated list of allowed frontend origins ───────────────────
CLIENT_URL=http://localhost:3000

# ── JWT ───────────────────────────────────────────────────────────────────────
JWT_SECRET=your-secret-here                   # min 32 chars, use openssl rand -base64 32
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_CHILD_ACCESS_EXPIRES_IN=24h               # children get longer access tokens
JWT_CHILD_REFRESH_EXPIRES_IN=90d              # children stay logged in across browser closes

# ── File Storage ──────────────────────────────────────────────────────────────
STORAGE_PROVIDER=local                        # "local" | "r2"
UPLOADS_BASE_PATH=./uploads                   # local dev storage path

# Cloudflare R2 (only needed when STORAGE_PROVIDER=r2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# ── Email (SMTP) — M9 ─────────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-app-password                   # Gmail App Password, not account password
SMTP_FROM=your-gmail@gmail.com                # Must match SMTP_USER for Gmail

# ── Invitations ───────────────────────────────────────────────────────────────
INVITE_TOKEN_EXPIRES_HOURS=168                # 7 days

# ── Admin ─────────────────────────────────────────────────────────────────────
ADMIN_INVITE_CODE=your-admin-invite-code      # Required to register an admin account

# ── ngrok / Remote Testing ────────────────────────────────────────────────────
# Set this when sharing via ngrok so invite + notification email links work externally
# FRONTEND_URL=https://xxxx.ngrok-free.app
```

### Frontend (`frontend/.env.local`)

```dotenv
# Only needed for remote/ngrok testing.
# Leave commented out for local development (Next.js proxy handles /api/v1).
# NEXT_PUBLIC_API_URL=https://xxxx.ngrok-free.app/api/v1
```

---

## 9. Project Structure

```
task-buddy/
├── package.json                 # Root workspace config
│
├── shared/                      # @taskbuddy/shared — types & constants
│   └── src/
│       ├── types/
│       │   └── models.ts        # User, Task, Reward, RewardWithCapData interfaces
│       └── constants/
│           └── validation.ts    # PASSWORD, PIN, FAMILY_CODE rules
│
├── backend/                     # Express REST API
│   ├── prisma/
│   │   ├── schema.prisma        # Database schema + all models
│   │   ├── migrations/          # Migration history
│   │   └── seed.ts              # Database seeder
│   ├── src/
│   │   ├── config.ts            # Environment variable access
│   │   ├── index.ts             # Express app bootstrap + scheduler + cron init
│   │   ├── middleware/
│   │   │   ├── auth.ts          # JWT authentication middleware
│   │   │   ├── errorHandler.ts  # Global error handler + custom error classes
│   │   │   └── validate.ts      # Zod request body validation middleware
│   │   ├── routes/
│   │   │   ├── index.ts         # API router — mounts all sub-routers
│   │   │   ├── auth.ts          # /auth/* endpoints
│   │   │   ├── family.ts        # /families/* endpoints
│   │   │   ├── tasks.ts         # /tasks/* endpoints (M9: email triggers)
│   │   │   ├── rewards.ts       # /rewards/* endpoints (M6: cap guard, M9: email triggers)
│   │   │   ├── dashboard.ts     # /dashboard/* endpoints
│   │   │   ├── uploads.ts       # /uploads/* endpoints
│   │   │   ├── admin.ts         # /admin/* endpoints (M8)
│   │   │   └── emails.ts        # /admin/emails/* endpoints (M9)
│   │   ├── services/
│   │   │   ├── auth.ts          # Registration, login, token management
│   │   │   ├── invite.ts        # Co-parent invite flow (M9: uses EmailService)
│   │   │   ├── email.ts         # M9: EmailService — SMTP + retry + logging
│   │   │   ├── storage.ts       # File upload (local + R2)
│   │   │   ├── achievements.ts  # Achievement unlock checks
│   │   │   ├── levelService.ts  # M7: level-up detection + milestone_bonus Points
│   │   │   ├── streakService.ts # Streak calculation + grace period
│   │   │   ├── scheduler.ts     # node-cron: reward expiry deactivation (M6)
│   │   │   └── database.ts      # Prisma client singleton
│   │   ├── emails/              # M9: HTML email templates
│   │   │   ├── base.ts          # Branded layout + renderTemplate() dispatcher
│   │   │   ├── welcome.ts
│   │   │   ├── taskSubmitted.ts
│   │   │   ├── taskApproved.ts
│   │   │   ├── taskRejected.ts
│   │   │   ├── taskExpiring.ts
│   │   │   ├── taskExpired.ts
│   │   │   ├── rewardRedeemed.ts
│   │   │   ├── levelUp.ts
│   │   │   ├── streakAtRisk.ts
│   │   │   └── coParentInvite.ts
│   │   ├── jobs/                # M9: scheduled email jobs
│   │   │   ├── expiryEmailCron.ts    # 00:05 daily — expiring + expired task emails
│   │   │   └── streakAtRiskCron.ts   # 18:00 daily — streak-at-risk parent alerts
│   │   └── utils/
│   │       ├── assignmentLimits.ts  # M5: task cap checks (max 3, max 1 primary)
│   │       ├── rewardCaps.ts        # M6: three-gate redemption guard + computed cap data
│   │       └── gamification.ts      # M7: TASK_XP map, LEVEL_MULTIPLIER, STREAK_MILESTONE_POINTS
│   └── .env.example
│
└── frontend/                    # Next.js PWA
    ├── public/
    │   └── manifest.json        # PWA manifest
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx                          # Landing / login redirect
        │   ├── login/page.tsx
        │   ├── register/page.tsx
        │   ├── invite/accept/page.tsx            # Co-parent invite acceptance
        │   ├── parent/
        │   │   ├── dashboard/page.tsx            # M9: memberCount = parents + children
        │   │   ├── tasks/page.tsx
        │   │   ├── tasks/new/page.tsx
        │   │   ├── tasks/[id]/edit/page.tsx
        │   │   ├── rewards/page.tsx              # M6: Sold Out / Expired badges
        │   │   ├── rewards/new/page.tsx          # M6: cap fields added
        │   │   ├── rewards/[id]/edit/page.tsx    # M6: cap fields + usage status
        │   │   ├── children/page.tsx
        │   │   └── settings/page.tsx             # M9: notification preferences toggles
        │   ├── admin/
        │   │   ├── dashboard/page.tsx            # M8: platform overview
        │   │   ├── families/page.tsx             # M8: family list + suspend/reactivate
        │   │   ├── families/[id]/page.tsx        # M8: family detail view
        │   │   ├── users/page.tsx                # M8: cross-family user search
        │   │   ├── achievements/page.tsx         # M8: global achievement CRUD
        │   │   ├── audit-log/page.tsx            # M8: audit log viewer
        │   │   └── emails/page.tsx               # M9: email log viewer + resend
        │   └── child/
        │       ├── dashboard/page.tsx
        │       ├── tasks/page.tsx
        │       └── rewards/page.tsx              # M6: greyed-out expired/sold-out rewards
        ├── components/
        │   ├── layouts/
        │   │   ├── ParentLayout.tsx
        │   │   ├── ChildLayout.tsx
        │   │   └── AdminLayout.tsx               # M8
        │   ├── ui/
        │   │   ├── Button.tsx
        │   │   ├── Input.tsx
        │   │   └── Toast.tsx
        │   ├── InviteCoParentModal.tsx
        │   └── ResetPinModal.tsx
        ├── contexts/
        │   └── AuthContext.tsx                  # Global auth state
        └── lib/
            ├── api.ts                           # All API call functions (incl. emailsApi M9)
            └── utils.ts                         # Helpers (formatPoints, getInitials, etc.)
```

---

## 10. Development Roadmap

The project follows a 5-phase plan spanning approximately 18 weeks.

### Phase 0 — Foundation (Weeks 1–3) ✅ Complete
Core infrastructure, authentication, and co-parent support.

| Milestone | Description | Status |
|---|---|---|
| M1 | Task edit bug fix, streak grace period, approval workflow | ✅ Done |
| M2 | File storage with Cloudflare R2 + Sharp thumbnail generation | ✅ Done |
| M3 | Memorable family codes (ADJECTIVE-ANIMAL-NNNN) + persistent child sessions | ✅ Done |
| M4 | Co-parent / spouse invite flow + cancellation | ✅ Done |

### Phase 1 — Core Gameplay (Weeks 4–6) ✅ Complete
Task rules, dual XP/Points currency, reward caps.

| Milestone | Description | Status |
|---|---|---|
| M5 | Task tags (primary/secondary), assignment limits (max 3, max 1 primary), overlap warnings | ✅ Done |
| M6 | Reward triple-cap — per-child limit, household total cap, expiry date with countdown | ✅ Done |
| M7 | XP/Points dual currency — separate progression from purchasing, level-up bonus points, streak milestone bonuses | ✅ Done |

### Phase 2 — Admin & Audit (Weeks 7–9) ✅ Complete
Admin dashboard and full audit logging.

| Milestone | Description | Status |
|---|---|---|
| M8 | Admin dashboard, platform overview, family suspension, cross-family user management, achievement CRUD, immutable audit log | ✅ Done |

### Phase 3 — Email Notifications (Weeks 10–12) ✅ Complete
Full email notification system with preferences and admin log viewer.

| Milestone | Description | Status |
|---|---|---|
| M9 | EmailService with SMTP retry + email_logs, 10 HTML templates, task/reward/auth triggers, expiry cron (00:05), streak-at-risk cron (18:00), notification preference toggles, admin email log viewer + resend | ✅ Done |

### Phase 4 — Reports Module (Weeks 13–15)
10 exportable reports (CSV/PDF) covering tasks, points, rewards, streaks, and audit trails.

### Phase 5 — Real-time & Polish (Weeks 16–18)
WebSockets for live task updates, leaderboard, PWA push notifications, child avatar picker.

---

## 11. Testing

### Acceptance Tests (Phase 0)

**M3 — Family Codes**
1. Child logs in using `MEGA-VIPER-8481` (or your family's code) + PIN → reaches dashboard
2. Close browser completely, reopen, navigate to app → child is still logged in (persistent session)
3. Parent session → close browser, reopen → redirected to login (session cleared)

**M4 — Co-Parent Invite**
1. Go to **Settings → Family Members** → click **Invite Adult** → enter email → Send
2. Check inbox — receive invite email with link
3. Click link → see "You've been invited to join [Family Name] by [Parent Name]"
4. Fill in name, date of birth, phone (optional), password → Create Account
5. Log in as co-parent → full parent access (create tasks, rewards, approve completions)
6. Log in as primary parent → **Settings → Family Members** → trash icon visible on co-parent row → remove works
7. Primary parent can cancel pending invite (✕ button on pending invite row)

### Acceptance Tests (Phase 1)

**M5 — Task Rules**
1. Assign a 4th task to a child → HTTP 409 "Maximum 3 active assignments"
2. Complete primary task, then try to claim a secondary task while primary is still pending → blocked
3. Create two tasks with overlapping times for the same child → overlap warning shown on parent dashboard

**M6 — Reward Triple Cap** ✅ All passed
1. **Household cap** — Create reward with `maxRedemptionsTotal=2`. Have 2 children redeem it. Third child attempt → HTTP 409 "This reward has been fully claimed by the household." Reward shows "Sold Out".
2. **Per-child cap** — Create reward with `maxRedemptionsPerChild=1`. Same child redeems twice → HTTP 409 "You have already claimed this reward the maximum number of times."
3. **Expiry** — Create reward with `expiresAt` 2 minutes away. Countdown badge visible. After expiry → reward shows "Expired" and is greyed out. Redemption attempt → HTTP 409 "This reward has expired."

**M7 — XP & Points Dual Currency** ✅ All passed
1. **Dual currency on approval** — Approve a `hard` difficulty task → child's `pointsBalance` increases by `task.pointsValue`, and `experiencePoints` / `totalXpEarned` each increase by 35 XP. Redeeming a reward decreases Points only — XP is never affected.
2. **Level-up milestone bonus** — Award enough XP to cross Level 1 → 2 threshold (100 XP). A `milestone_bonus` entry appears in `points_ledger` for +10 Points. Level-up celebration modal fires in the child dashboard.
3. **Streak milestone bonus** — Child hits a 7-day streak → `milestone_bonus` ledger entry for +35 Points is created. Streak counter remains unaffected.
4. **Parent registration fields** — Register a new family with `dateOfBirth` (required) and `phoneNumber` (optional). `GET /auth/me` returns both fields correctly.

### Acceptance Tests (Phase 2)

**M8 — Admin & Audit** ✅ All passed
1. **Recurring task generation** — Create a recurring task with weekly recurrence. Trigger the midnight cron. New assignment appears for the next day with status `pending`.
2. **Admin login & platform view** — Register admin with `ADMIN_INVITE_CODE`. Admin lands on `/admin/dashboard`. Overview shows correct counts of total families and users. Admin can navigate to Families, Users, Audit Log, and Achievements pages.
3. **Audit log captures mutations** — As a parent, create a task, approve a submission, and redeem a reward. Filter audit log by parent's user ID → three entries appear with correct action, resourceType, and timestamp.

### Acceptance Tests (Phase 3)

**M9 — Email Notifications** ✅ All passed
1. **Task submission email** — Child marks task complete → parent receives email within 60 seconds. Subject: "[Child Name] completed [Task Name]". Email shows task title, child name, completion time, and "Review Submission" link. Co-parent also receives the email.
2. **Expiry warning cron** — Create a task with `dueDate` 20 hours from now. Wait for (or manually trigger) the 00:05 cron. Parent receives "Task Expiring Soon" email. `emailSentAt` is set on the assignment — email is NOT sent again on the next cron run.
3. **Opt-out respected** — In Parent Settings, disable "Task Submitted" notification. Child completes a task → no email is queued. The admin email log confirms no entry was created (not queued and dropped — not queued at all). All other notification types remain active.

---

## 12. Deployment

### Production Checklist

```bash
# Backend
NODE_ENV=production
STORAGE_PROVIDER=r2           # Switch to Cloudflare R2
JWT_SECRET=<strong random>    # openssl rand -base64 48
DATABASE_URL=<prod postgres>
SMTP_HOST=smtp.gmail.com
SMTP_USER=<gmail>
SMTP_PASS=<app password>
FRONTEND_URL=https://your-frontend-domain.com

# Frontend
NEXT_PUBLIC_API_URL=https://your-api-domain.com/api/v1
```

### Recommended Stack
- **Frontend**: Vercel (automatic Next.js deployment)
- **Backend**: Railway or Render (Node.js + managed PostgreSQL)
- **File storage**: Cloudflare R2 (already integrated)
- **Email**: Gmail SMTP with App Password (dev) → SendGrid or Mailgun (production)

### Database Backup
```bash
pg_dump taskbuddy > backup_$(date +%Y%m%d).sql
```

---

## 13. Academic Context

### Project Information
| Field | Detail |
|---|---|
| Programme | BSc Information Technology |
| Institution | Regional Maritime University, Ghana |
| Project Type | End-of-Programme Project |
| Academic Year | 2025–2026 |
| Student | Souleymane Camara |

### Research Questions
1. How can gamification mechanics increase children's task completion rates in a household context?
2. What authentication patterns are most appropriate for children aged 10–16 who may not have personal email addresses?
3. How should a multi-parent family model be designed to avoid permission hierarchies while still enabling account governance?

### Key Design Decisions

**PIN + Family Code Authentication for Children**
Children aged 10–16 often lack personal email addresses and find password managers impractical. TaskBuddy uses a memorable family code (e.g. `MEGA-VIPER-8481`) combined with a 4-digit PIN — lowering the login barrier while maintaining per-child account separation.

**Dual XP/Points Currency**
XP drives level progression (cosmetic, cannot be spent) while Points are the spendable currency for rewards. This prevents children from sacrificing long-term progression for short-term purchases — a common flaw in single-currency gamification systems.

**Co-Parent Role Design**
Rather than introducing a hierarchical co-parent role, the system reuses the existing `parent` role with an `isPrimaryParent` boolean. This ensures all permission middleware works without modification, and co-parents gain full access instantly upon accepting an invite.

**Persistent Child Sessions**
Children's refresh tokens are stored in `localStorage` (persisting browser closes) while parents use `sessionStorage` (cleared on browser close). This reduces login friction for children — who frequently close tabs accidentally — while maintaining stricter session control for parents who have account governance authority.

**Reward Cap Architecture (M6)**
Rewards support three independent constraints: a per-child redemption limit, a household-wide total cap, and an optional expiry date. All three are enforced server-side in a sequential three-gate check that returns distinct HTTP 409 error messages for each case. Computed fields (`isSoldOut`, `isExpired`, `remainingTotal`, `remainingForChild`) are appended to every reward response so the frontend can render accurate state without additional API calls.

**XP Calculation System (M7)**
XP is awarded only on task **approval** (not on completion). The amount is determined by the task's difficulty:

| Difficulty | XP Awarded |
|---|---|
| Easy | 10 XP |
| Medium | 15 XP |
| Hard | 35 XP |

Two separate XP fields are maintained on `child_profiles`:
- `experiencePoints` — XP progress within the current level (used for the progress bar)
- `totalXpEarned` — Lifetime XP accumulator, never decremented, drives level calculation

Level thresholds follow an exponential curve: Level 1 → 2 requires 100 XP, with each subsequent level requiring 50% more (`floor(100 × 1.5^(level-1))`). Level-up detection runs after every XP award — if a threshold is crossed, the level is updated and a `milestone_bonus` Points entry is created for `newLevel × 5` Points.

**Primary / Secondary Task System (M5)**
Tasks are classified as `primary` (must-do assignments) or `secondary` (optional bonus tasks). Children cannot claim secondary tasks while a primary task is pending. Assignment limits (max 3 total, max 1 primary) are enforced server-side.

**Email Notification Architecture (M9)**
All email delivery is centralised through `EmailService` — a single class that handles SMTP transport, retry logic (up to 2 retries on transient failures), notification preference checks, and audit logging to `email_logs`. All calls are fire-and-forget so SMTP issues never block API responses. Parent-targeted emails (task submitted, reward redeemed, etc.) are sent to all active parent-role users in the family via `sendToFamilyParents()`. Two cron jobs run daily: an expiry scan at 00:05 and a streak-at-risk alert at 18:00. The `emailSentAt` field on `task_assignments` prevents duplicate cron emails.

---

## License

This project was developed as an academic submission for Regional Maritime University, Ghana. All rights reserved.

---

*TaskBuddy Development Roadmap v3.0 · 11 Change Requests · ~18 weeks · February 2026*
*Phases 0–3 complete (M1–M9) · Phases 4–5 in progress*