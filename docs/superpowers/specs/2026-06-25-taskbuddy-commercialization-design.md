# TaskBuddy Commercialization Design

**Date:** 2026-06-25
**Owner / Copyright Holder:** Evolution Prime IT Ltd
**Status:** Approved (design phase)

## 1. Purpose

Move TaskBuddy from an academic end-of-programme project into a live,
revenue-generating commercial product available on web and mobile (iOS and
Android). This document defines the scope of the cleanup, the
commercialization architecture, the revenue model, the licensing approach,
and the roadmap of what is missing or needs improvement.

## 2. Goals

- Remove every reference to the academic origin (Regional Maritime University,
  the student name, programme, research questions, academic framing).
- Remove all literal em dashes (U+2014) from project source and docs, applying
  a context-aware replacement rule.
- Establish correct legal and licensing posture for a paid product directed at
  children, owned by Evolution Prime IT Ltd.
- Define the path to App Store and Play Store presence and a subscription
  revenue stream.
- Produce a prioritized roadmap of gaps and improvements.

## 3. Non-Goals

- Implementing billing, mobile builds, or marketing assets in this phase. This
  document is the design; implementation follows in a separate plan.
- Legal sign-off. Drafted Privacy Policy / Terms are starting templates and
  require review by a qualified lawyer before launch.
- Rewriting the existing PWA into React Native (explicitly rejected in favor of
  Capacitor).

## 4. Cleanup Scope

### 4.1 School-project removal

The academic content is concentrated in `README.md`. The earlier code-file grep
hits were false positives (for example "photo*synthesis*", "push*Subscription*").

| Location | Action |
|---|---|
| `README.md` lines 3-5 (header blockquote) | Remove the academic project / institution / student lines. Replace with a product tagline and links. |
| `README.md` TOC item 13 and section 13 "Academic Context" | Convert the genuinely useful engineering content (design decisions, XP system, real-time architecture, performance notes) into a "Design Notes / Architecture Decisions" section. Delete academic framing: Programme, Institution, Project Type, Academic Year, Student, Research Questions. |
| `README.md` License section and footer | Replace academic "All rights reserved for RMU" with the proprietary license notice for Evolution Prime IT Ltd and a product footer. |
| `TaskBuddy_User_Manual.pdf` (root) | Keep as a product manual. Flag for later rebranding. |
| `do_not_upload/Chapter_04.pdf` | Delete (academic thesis chapter). |
| `do_not_upload/*.md` (human, project, tree, plan, etc.) | Keep. These are working/planning docs, not school-specific. |
| Root junk files (`(typeof`, `({`, `0`, `1`, `,`, `,+`, `,-`, `Math.max(1`, etc.) | Delete. Accidental shell-redirect artifacts. |

### 4.2 Em dash removal rule

Roughly 1,000 literal em dashes (U+2014), mostly in `README.md` prose and
headings and in `do_not_upload/` docs, with some in backend email/UI copy and
comments. Replacement is context-aware:

- Headings ("Step 1 - Clone") become a colon form ("Step 1: Clone").
- Prose, email, and UI copy use a comma, colon, or parentheses so the sentence
  reads naturally.
- Code comment separators use a plain hyphen.
- Decorative box-drawing lines (`---` rendered with U+2500) are a different
  character and are **left as-is** (confirmed by owner).

## 5. Commercialization Architecture

### 5.1 Mobile (decided: Capacitor)

Wrap the existing Next.js PWA in Capacitor to produce real iOS and Android apps
from essentially one codebase. Reuses everything already built. Native
capabilities (push, camera for photo evidence) come through Capacitor plugins.
React Native rewrite was rejected (large second codebase, no proportional
benefit at this stage).

### 5.2 Revenue model (decided: subscription freemium)

For a product directed at children, ad-based and aggressive in-app-purchase
models are legally fraught (COPPA 2025, GDPR-K, UK Children's Code) and rejected
by app reviewers. Market and compliance guidance converge on parent-billed
subscription freemium.

- **Free tier:** 1 parent, up to 2 children, core tasks and points, limited
  reward slots.
- **Family Premium:** approximately $4.99/month or $39.99/year (market band:
  BusyKid $38.99/yr, Cozi $29.99/yr, Greenlight $5.99/mo). Unlocks multi-parent,
  unlimited children and rewards, all 10 analytics reports, photo evidence,
  email notifications, premium games/avatars.
- **Billing plumbing:** Stripe on web; App Store / Play in-app purchase on
  mobile (stores require their own billing for digital goods). RevenueCat to
  unify entitlements across web, iOS, and Android so one subscription state
  drives all platforms.

Sources: chore-app pricing (wellkeptwallet, kiddikash), RevenueCat kids-app
monetization, COPPA/kids monetization (openback).

### 5.3 Licensing and legal

- **Code license:** Proprietary, "All Rights Reserved", copyright Evolution
  Prime IT Ltd. A commercial product that is sold is not open-sourced. This is
  the correct `LICENSE` file.
- **Required legal documents** (these, not a code license, are what the app
  stores and child-privacy law mandate):
  - Privacy Policy (COPPA / GDPR-K compliant).
  - Terms of Service / EULA.
  - Verifiable parental consent flow.
  - Drafts are templates only and require lawyer review before launch.

## 6. Roadmap: What Is Missing / To Improve

### 6.1 Must-have before launch (blockers)

- Billing and subscriptions (Stripe + RevenueCat + store IAP) with entitlement
  gating across web and mobile.
- Privacy Policy, Terms of Service, and verifiable parental consent (COPPA).
- Production infrastructure: managed Postgres, object storage (R2 already
  wired), authenticated email domain with SPF/DKIM, secrets management, HTTPS
  custom domain.
- Capacitor wrap producing iOS and Android builds; store listings, icons, and
  splash screens (PWA icons partly exist).
- Error monitoring (Sentry), uptime monitoring, automated database backups.
- Rate limiting and a security hardening pass (action the existing
  `security_assessment.md`).

### 6.2 Should-have for growth

- Marketing/landing site with SEO; privacy-safe analytics (for example
  Plausible); onboarding flow; transactional email polish.
- Account deletion and data export (GDPR); review of localStorage token strategy
  for production.
- CI/CD pipeline, staging environment, automated tests running in CI.

### 6.3 Nice-to-have

- Referral program; in-app purchase add-ons (avatar/theme packs); push
  notifications via Capacitor; internationalization.

## 7. Deliverables of the Implementation Phase

1. Cleaned `README.md` (no academic references, no em dashes, rebranded).
2. Deleted academic and junk artifacts.
3. Em dash cleanup applied across source and docs per the rule above.
4. `LICENSE` file: proprietary, Evolution Prime IT Ltd.
5. Draft `PRIVACY.md` and `TERMS.md` (template-level, for lawyer review).
6. (Later sub-projects, each with its own spec/plan) Billing integration,
   Capacitor mobile builds, production infra and monitoring.

## 8. Open Questions

None outstanding. Decisions captured: leave box-drawing separators; delete
`Chapter_04.pdf`; copyright holder Evolution Prime IT Ltd; Capacitor for mobile;
subscription freemium revenue; proprietary license.
