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
- **In-app notifications** — real-time bell with socket-pushed alerts and a 60-second polling fallback
- **10 analytics reports** — CSV/PDF-exportable task, points, reward, streak, achievement, and leaderboard reports
- **Real-time live updates** — socket-driven dashboard counters, achievement celebrations, and streak toasts

---

## 2. Key Features

### For Parents
| Feature | Description |
|---|---|
| Family registration | Create a family account with a unique memorable code |
| Co-parent invite | Invite a spouse, partner, guardian, or other adult via email link |
| Task management | Create, assign, edit, and archive tasks with difficulty ratings and primary/secondary tags |
| Approval workflow | Review photo evidence and approve or reject completions with feedback |
| Reward catalogue | Create redeemable rewards with point costs, per-child limits, household caps, and expiry dates |
| Family code management | Regenerate the family login code at any time |
| Email notifications | Receive emails for task submissions, approvals, reward redemptions, level-ups, and streak alerts |
| Notification preferences | Toggle each email type on/off per family from the Settings page |
| In-app notification bell | Real-time bell badge with dropdown — socket-pushed, polling fallback |
| Reports | 7 family-scoped analytics reports with date filters, child filters, CSV/PDF export |
| Settings | Configure grace periods, leaderboard visibility, auto-approve rules |

### For Children
| Feature | Description |
|---|---|
| PIN + family code login | Log in with a memorable code and a 4-digit PIN — no email needed |
| Persistent sessions | Stay logged in across browser closes (via localStorage) |
| Task dashboard | See primary and secondary tasks separately — secondary tasks unlock when primary is done |
| Returned tasks | Tasks rejected by a parent appear in a "Returned" tab with feedback and a Resubmit button |
| Photo evidence | Upload proof of completion directly from the task card |
| XP & levelling | Earn XP to unlock new levels (cosmetic progression, cannot be spent) |
| Points & rewards | Earn points to redeem against parent-created rewards |
| Streak tracking | Daily streak counter with configurable grace periods |
| Achievements | Unlock badges for milestones — celebrated with live toast notifications |
| Reward shop | See live cap status — "Sold Out" and "Expired" rewards are clearly labelled |
| In-app notifications | Bell badge with real-time socket push and 60-second polling fallback |

### For Admins
| Feature | Description |
|---|---|
| Platform overview | Total families, users, tasks, and health stats |
| Family management | View, suspend, and reactivate families |
| User management | Cross-family user search |
| Achievement CRUD | Create and manage global achievement definitions |
| Audit log | Immutable, filterable record of all mutations |
| Email log viewer | Paginated email delivery history with resend capability |
| Platform reports | 10 reports including Audit Trail, Email Delivery, and Platform Health — with family/child filters |

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
| Recharts | — | M10: charts for all 10 analytics reports |
| Socket.io-client | — | M10: real-time WebSocket connection |

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
| Socket.io | — | M10: WebSocket server for real-time events |
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
│   Admin Dashboard   │  Reports (M10)    │                   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / REST
                               │ JWT Bearer Token (Authorization header)
                               │ Refresh Token (httpOnly cookie)
                               │ WebSocket (Socket.io) ← M10
┌──────────────────────────────▼──────────────────────────────┐
│                       Backend API                           │
│              Express + TypeScript (localhost:3001)          │
│                                                             │
│  /auth/*     /families/*     /tasks/*     /rewards/*        │
│  /children/* /dashboard/*    /uploads/*   /admin/*          │
│  /notifications/*  /reports/*             ← M10             │
│                                                             │
│  Middleware: authenticate → requireParent / requireChild    │
│  Validation: Zod schemas on all request bodies              │
│  Scheduler:  node-cron jobs (expiry, streak-at-risk)        │
│  EmailService: Nodemailer + SMTP retry + email_logs         │
│  SocketService: Socket.io rooms (family:* + user:*)  ← M10 │
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

### Real-time Event Model (M10)

```
Socket rooms:
  family:{familyId}  — family-wide events (task:submitted, task:approved, points:updated)
  user:{userId}      — user-specific events (notification:new, achievement:unlocked)

Events emitted by server:
  task:submitted       → parent room: pending approval count incremented
  task:approved        → child user: points/XP updated, celebration triggered
  task:rejected        → child user: task moved to Returned tab
  points:updated       → child user: live balance update in dashboard
  achievement:unlocked → child user: AchievementToast celebration
  streak:milestone     → child user: StreakMilestoneToast
  notification:new     → user room: bell badge incremented, dropdown prepended
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

notifications                              ← M10: in-app notification bell
  id, userId, notificationType, title, message
  actionUrl, referenceType, referenceId
  isRead, readAt, createdAt
  @@index([userId, isRead, createdAt])     ← composite index for bell queries

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
init_schema                          — all base tables
add_memorable_family_code            — families.familyCode
add_co_parent_support                — users.isPrimaryParent + family_invitations
add_user_dob_phone                   — users.dateOfBirth + users.phone
add_task_tag_and_schedule            — tasks.taskTag + tasks.startTime/estimatedMinutes (M5)
add_reward_total_cap                 — rewards.maxRedemptionsTotal (M6)
m7_xp_dual_currency                  — child_profiles.totalXpEarned + TransactionType.milestone_bonus
m8_admin_audit                       — audit_logs + families.isSuspended
add_email_logs                       — email_logs + task_assignments.emailSentAt + EmailLogStatus
add_email_log_relations              — EmailLog relations to User and Family
m10_notifications                    — notifications table + composite index (M10)
add_notification_composite_index     — @@index([userId, isRead, createdAt(sort: Desc)]) (M10 perf fix)
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
POST   /api/v1/families/children/capacities     Batch child capacity check
```

### Tasks
```
GET    /api/v1/tasks                        List tasks (filterable by tag, status, child)
POST   /api/v1/tasks                        Create task + assignments (fires notification:new to each child)
GET    /api/v1/tasks/:id
PUT    /api/v1/tasks/:id
DELETE /api/v1/tasks/:id
GET    /api/v1/tasks/:id/assignments        List assignments for a task
GET    /api/v1/tasks/assignments/me         Child's own assignments (incl. rejected — for Returned tab)
PUT    /api/v1/tasks/assignments/:id/complete   Child submits (also accepts rejected → resubmit)
PUT    /api/v1/tasks/assignments/:id/approve    Parent approves or rejects with optional feedback
POST   /api/v1/tasks/assignments/:id/upload     Upload photo evidence (multipart)
POST   /api/v1/tasks/assignments/self-assign    Child self-assigns a secondary task
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

### Notifications (M10)
```
GET    /api/v1/notifications           List notifications for current user (limit, unreadOnly)
GET    /api/v1/notifications/unread-count   Fast unread count for bell badge
PUT    /api/v1/notifications/:id/read       Mark single notification as read
PUT    /api/v1/notifications/read-all       Mark all notifications as read
DELETE /api/v1/notifications/:id            Delete a notification
```

### Reports (M10)
```
GET    /api/v1/reports/task-completion      R-01: task completion rates + trends
GET    /api/v1/reports/points-ledger        R-02: points earned/spent breakdown
GET    /api/v1/reports/reward-redemptions   R-03: reward claim history
GET    /api/v1/reports/engagement-streak    R-04: streak and engagement over time
GET    /api/v1/reports/achievements         R-05: achievement unlock summary
GET    /api/v1/reports/leaderboard          R-06: family leaderboard snapshot
GET    /api/v1/reports/expiry-overdue       R-07: expiring and overdue tasks
GET    /api/v1/reports/audit-trail          R-08: audit log export (admin only)
GET    /api/v1/reports/email-delivery       R-09: email delivery stats (admin only)
GET    /api/v1/reports/platform-health      R-10: platform-wide stats (admin only)
GET    /api/v1/reports/export               CSV/PDF export for any report
```

All report endpoints accept `?startDate=`, `?endDate=`, `?childId=` query params. Admin endpoints additionally accept `?familyId=`.

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

Restart both services. Invite links and all notification emails will now point to the ngrok URL.

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
JWT_SECRET=your-secret-here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_CHILD_ACCESS_EXPIRES_IN=24h
JWT_CHILD_REFRESH_EXPIRES_IN=90d

# ── File Storage ──────────────────────────────────────────────────────────────
STORAGE_PROVIDER=local
UPLOADS_BASE_PATH=./uploads

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
SMTP_PASS=your-app-password
SMTP_FROM=your-gmail@gmail.com

# ── Invitations ───────────────────────────────────────────────────────────────
INVITE_TOKEN_EXPIRES_HOURS=168

# ── Admin ─────────────────────────────────────────────────────────────────────
ADMIN_INVITE_CODE=your-admin-invite-code

# ── ngrok / Remote Testing ────────────────────────────────────────────────────
# FRONTEND_URL=https://xxxx.ngrok-free.app
```

### Frontend (`frontend/.env.local`)

```dotenv
# Only needed for remote/ngrok testing.
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
│       │   └── models.ts
│       └── constants/
│           └── validation.ts
│
├── backend/                     # Express REST API
│   ├── prisma/
│   │   ├── schema.prisma        # Database schema + all models
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── config.ts
│   │   ├── index.ts             # Express bootstrap + Socket.io init + cron
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── errorHandler.ts
│   │   │   └── validate.ts
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── auth.ts
│   │   │   ├── family.ts
│   │   │   ├── tasks.ts          # M10: task_assigned notification on create
│   │   │   ├── rewards.ts
│   │   │   ├── dashboard.ts      # M10: N+1 queries eliminated via groupBy
│   │   │   ├── uploads.ts
│   │   │   ├── admin.ts
│   │   │   ├── emails.ts
│   │   │   ├── notifications.ts  # M10: in-app bell CRUD
│   │   │   └── reports.ts        # M10: 10 report endpoints + CSV/PDF export
│   │   ├── services/
│   │   │   ├── auth.ts
│   │   │   ├── invite.ts
│   │   │   ├── email.ts
│   │   │   ├── storage.ts
│   │   │   ├── achievements.ts
│   │   │   ├── levelService.ts
│   │   │   ├── streakService.ts
│   │   │   ├── scheduler.ts
│   │   │   ├── database.ts       # Shared Prisma singleton (all routes use this)
│   │   │   ├── SocketService.ts  # M10: Socket.io server + room management
│   │   │   ├── ReportService.ts  # M10: report query logic (uses shared prisma)
│   │   │   └── AuditService.ts
│   │   ├── emails/
│   │   │   └── *.ts              # 10 HTML email templates
│   │   ├── jobs/
│   │   │   ├── expiryEmailCron.ts
│   │   │   └── streakAtRiskCron.ts
│   │   └── utils/
│   │       ├── assignmentLimits.ts
│   │       ├── rewardCaps.ts
│   │       └── gamification.ts
│   └── .env.example
│
└── frontend/                    # Next.js PWA
    ├── public/
    │   └── manifest.json
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx
        │   ├── login/page.tsx
        │   ├── register/page.tsx
        │   ├── invite/accept/page.tsx
        │   ├── parent/
        │   │   ├── dashboard/page.tsx    # M10: socket live updates, isLoading=false
        │   │   ├── tasks/page.tsx
        │   │   ├── tasks/new/page.tsx
        │   │   ├── tasks/[id]/edit/page.tsx
        │   │   ├── rewards/page.tsx
        │   │   ├── rewards/new/page.tsx
        │   │   ├── rewards/[id]/edit/page.tsx
        │   │   ├── children/page.tsx
        │   │   ├── reports/page.tsx      # M10: 7 parent-scoped reports
        │   │   └── settings/page.tsx     # M10: isLoading=false perf fix
        │   ├── admin/
        │   │   ├── dashboard/page.tsx
        │   │   ├── families/page.tsx
        │   │   ├── families/[id]/page.tsx
        │   │   ├── users/page.tsx
        │   │   ├── achievements/page.tsx
        │   │   ├── audit-log/page.tsx
        │   │   ├── emails/page.tsx
        │   │   └── reports/page.tsx      # M10: 10 reports + family/child filters
        │   └── child/
        │       ├── dashboard/page.tsx    # M10: socket live updates, isLoading=false
        │       ├── tasks/page.tsx        # M10: Returned tab + resubmit CTA
        │       └── rewards/page.tsx
        ├── components/
        │   ├── layouts/
        │   │   ├── ParentLayout.tsx      # M10: SocketProvider + NotificationProvider
        │   │   ├── ChildLayout.tsx       # M10: SocketProvider + NotificationProvider
        │   │   └── AdminLayout.tsx       # M10: Reports nav item added
        │   ├── reports/                  # M10: 10 report components (recharts)
        │   │   ├── TaskCompletionReport.tsx
        │   │   ├── PointsLedgerReport.tsx
        │   │   ├── RewardRedemptionReport.tsx
        │   │   ├── EngagementStreakReport.tsx
        │   │   ├── AchievementReport.tsx
        │   │   ├── LeaderboardReport.tsx
        │   │   ├── ExpiryOverdueReport.tsx
        │   │   ├── PlatformHealthReport.tsx
        │   │   ├── AuditTrailReport.tsx
        │   │   └── EmailDeliveryReport.tsx
        │   ├── ui/
        │   │   ├── Button.tsx
        │   │   ├── Input.tsx
        │   │   ├── Toast.tsx
        │   │   ├── AchievementToast.tsx  # M10: achievement celebration
        │   │   └── StreakMilestoneToast.tsx # M10: streak milestone celebration
        │   ├── NotificationBell.tsx      # M10: pure UI, reads NotificationContext
        │   ├── InviteCoParentModal.tsx
        │   └── ResetPinModal.tsx
        ├── contexts/
        │   ├── AuthContext.tsx
        │   ├── SocketContext.tsx         # M10: Socket.io client provider
        │   └── NotificationContext.tsx   # M10: singleton fetch/poll/socket handler
        └── lib/
            ├── api.ts                    # M10: GET cache (30s stale-while-revalidate)
            └── utils.ts
```

---

## 10. Development Roadmap

### Phase 0 — Foundation (Weeks 1–3) ✅ Complete

| Milestone | Description | Status |
|---|---|---|
| M1 | Task edit bug fix, streak grace period, approval workflow | ✅ Done |
| M2 | File storage with Cloudflare R2 + Sharp thumbnail generation | ✅ Done |
| M3 | Memorable family codes (ADJECTIVE-ANIMAL-NNNN) + persistent child sessions | ✅ Done |
| M4 | Co-parent / spouse invite flow + cancellation | ✅ Done |

### Phase 1 — Core Gameplay (Weeks 4–6) ✅ Complete

| Milestone | Description | Status |
|---|---|---|
| M5 | Task tags (primary/secondary), assignment limits, overlap warnings | ✅ Done |
| M6 | Reward triple-cap — per-child limit, household cap, expiry with countdown | ✅ Done |
| M7 | XP/Points dual currency — level-up bonus points, streak milestone bonuses | ✅ Done |

### Phase 2 — Admin & Audit (Weeks 7–9) ✅ Complete

| Milestone | Description | Status |
|---|---|---|
| M8 | Admin dashboard, platform overview, family suspension, achievement CRUD, audit log | ✅ Done |

### Phase 3 — Email Notifications (Weeks 10–12) ✅ Complete

| Milestone | Description | Status |
|---|---|---|
| M9 | EmailService, 10 HTML templates, all triggers, expiry/streak crons, preference toggles | ✅ Done |

### Phase 4 — Reports & Real-time (Weeks 13–18) ✅ Complete

| Milestone | Description | Status |
|---|---|---|
| M10 | 10 analytics reports (CSV/PDF), in-app notification bell, Socket.io real-time events, live dashboard updates, achievement/streak celebrations | ✅ Done |

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
6. Log in as primary parent → **Settings → Family Members** → trash icon visible → remove works
7. Primary parent can cancel pending invite (✕ button on pending invite row)

### Acceptance Tests (Phase 1)

**M5 — Task Rules**
1. Assign a 4th task to a child → HTTP 409 "Maximum 3 active assignments"
2. Complete primary task, then try to claim a secondary task while primary is still pending → blocked
3. Create two tasks with overlapping times for the same child → overlap warning shown

**M6 — Reward Triple Cap** ✅ All passed
1. **Household cap** — Create reward with `maxRedemptionsTotal=2`. Two children redeem it. Third attempt → HTTP 409 "This reward has been fully claimed by the household." Reward shows "Sold Out".
2. **Per-child cap** — Create reward with `maxRedemptionsPerChild=1`. Same child redeems twice → HTTP 409 "You have already claimed this reward the maximum number of times."
3. **Expiry** — Create reward with `expiresAt` 2 minutes away. After expiry → "Expired" badge. Redemption attempt → HTTP 409 "This reward has expired."

**M7 — XP & Points Dual Currency** ✅ All passed
1. Approve a `hard` task → child's `pointsBalance` increases by `task.pointsValue` and `experiencePoints` increases by 35 XP.
2. Level-up → `milestone_bonus` ledger entry for `newLevel × 5` Points. Level-up celebration modal fires.
3. 7-day streak → `milestone_bonus` ledger entry for +35 Points.

### Acceptance Tests (Phase 2)

**M8 — Admin & Audit** ✅ All passed
1. Create recurring task → trigger midnight cron → new assignment appears for next day.
2. Register admin with `ADMIN_INVITE_CODE` → lands on `/admin/dashboard` with correct platform counts.
3. Create task, approve submission, redeem reward → filter audit log by actor → three entries with correct action/resourceType/timestamp.

### Acceptance Tests (Phase 3)

**M9 — Email Notifications** ✅ All passed
1. Child marks task complete → parent receives email within 60 seconds with "Review Submission" link.
2. Task with `dueDate` 20 hours away → trigger 00:05 cron → parent receives expiry warning. `emailSentAt` set — no duplicate on next run.
3. Disable "Task Submitted" in settings → child completes task → no email queued. Admin email log confirms no entry.

### Acceptance Tests (Phase 4)

**M10 — Reports** ✅ All passed
1. Navigate to **Parent → Reports** → R-01 Completion chart renders with correct task counts for the selected date range.
2. Set child filter → all reports update to show only that child's data.
3. Click **Export CSV** → browser downloads a `.csv` file with correct headers and rows.
4. Navigate to **Admin → Reports** → all 10 tabs visible including Platform Health, Audit Trail, Email Delivery. Family ID filter applied → data scoped to that family.
5. Parent visits Reports → R-08 Audit Trail and R-09 Email Delivery tabs are NOT visible (admin-only).

**M10 — Notifications** ✅ All passed
1. Parent assigns a task → child's bell badge increments in real-time (socket push). Notification reads "New Task Assigned: [task name]".
2. Parent approves a task → child's bell badge increments. Notification reads "Task Approved! You earned +X pts".
3. Parent rejects a task with feedback → child's bell shows "Task Returned" notification. Task appears in **Returned** tab with parent's feedback. Child clicks **Resubmit** → task moves back to pending.
4. Close bell dropdown → badge count decrements for each read item. "Mark all read" clears badge instantly.
5. Disconnect network → bell falls back to 60-second polling. Reconnect → socket resumes, polling stops.

**M10 — Real-time Live Updates** ✅ All passed
1. Parent approves task → child dashboard points balance updates without page refresh. Level-up modal fires if threshold crossed.
2. Child unlocks an achievement → `AchievementToast` celebration slides in on their dashboard.
3. Child hits a streak milestone → `StreakMilestoneToast` fires with streak count.
4. Parent dashboard pending approval counter decrements live when another parent approves a task.

---

## 12. Deployment

### Production Checklist

```bash
# Backend
NODE_ENV=production
STORAGE_PROVIDER=r2
JWT_SECRET=<strong random>
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

Level thresholds follow an exponential curve: Level 1 → 2 requires 100 XP, with each subsequent level requiring 50% more (`floor(100 × 1.5^(level-1))`). Level-up detection runs after every XP award — if a threshold is crossed, the level is updated and a `milestone_bonus` Points entry is created for `newLevel × 5` Points.

**Primary / Secondary Task System (M5)**
Tasks are classified as `primary` (must-do assignments) or `secondary` (optional bonus tasks). Children cannot claim secondary tasks while a primary task is pending. Assignment limits (max 3 total, max 1 primary) are enforced server-side.

**Email Notification Architecture (M9)**
All email delivery is centralised through `EmailService` — a single class that handles SMTP transport, retry logic (up to 2 retries), notification preference checks, and audit logging to `email_logs`. All calls are fire-and-forget. Two cron jobs run daily: an expiry scan at 00:05 and a streak-at-risk alert at 18:00.

**Real-time Architecture (M10)**
Socket.io is used for all live updates. Two room types are maintained: `family:{familyId}` for family-wide events (task approvals, points updates) and `user:{userId}` for user-specific events (notifications, achievements). The server joins each socket to its rooms on connection using the JWT payload. The `NotificationContext` on the frontend acts as a singleton — a single fetch/poll/socket handler shared between the desktop sidebar bell and the mobile header bell, eliminating the double-fetch that previously occurred because CSS `display:none` does not prevent React components from mounting and running effects.

**Performance Architecture (M10)**
Several N+1 query patterns were eliminated: the parent dashboard child-stats block previously fired 3 COUNT queries per child; this was replaced with 3 `groupBy` queries covering all children at once. The leaderboard had the same pattern (2 queries per child). `weeklyStats` used a `$transaction` for three read-only queries — replaced with `Promise.all`. All notification routes now run `findMany` + `count` in parallel. The `ReportService` and `notifications` routes were also migrated from orphaned `new PrismaClient()` instances to the shared singleton, eliminating redundant connection pools. A 30-second stale-while-revalidate GET cache in `api.ts` serves repeat page visits instantly from memory.

---

## License

This project was developed as an academic submission for Regional Maritime University, Ghana. All rights reserved.

---

*TaskBuddy · M10 Complete · All 5 Phases Done · February 2026*
*Souleymane Camara · BSc Information Technology · Regional Maritime University, Ghana*