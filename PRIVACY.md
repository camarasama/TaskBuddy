# TaskBuddy Privacy Policy

> **Published for the closed test, and still under legal review.** Every statement here describes what
> the software actually does. A qualified lawyer is reviewing it; where their advice changes anything
> we will update this page and the version below.
>
> TaskBuddy is directed at children and is subject to COPPA (US), the GDPR including Art. 8 (EU), the
> UK GDPR and Age Appropriate Design Code, and Ghana's Data Protection Act, 2012 (Act 843).

**Version:** 1.2
**Last updated:** 2026-08-06
**Provider:** Evolution Prime IT Ltd ("we", "us", "our")
**Contact:** privacy@gettaskbuddy.com

---

## 1. Summary (plain-language)

TaskBuddy helps families organise chores and rewards. A parent or guardian creates the
account and any child profiles. We collect the minimum needed to run the service, we do
**not** sell personal data, and we do **not** show third-party behavioural advertising to
children. Parents can review, export, or delete their family's data at any time.

This policy is written to be understandable by parents; a short, child-friendly version is
also provided in-app for children.

## 2. Who this applies to and children's data

TaskBuddy is a family task-management application. **Parent/guardian accounts must be
created by an adult (18+).** Child profiles are created and managed by that parent/guardian,
who provides **verifiable parental consent** before any child data is collected or used
(see §5). TaskBuddy child profiles are intended for children aged **10–16**; we do not knowingly create accounts for children below the applicable minimum age without verifiable
parental consent, and where a jurisdiction sets a higher digital-consent age we rely on the
parent's consent under GDPR Article 8.

## 3. Information we collect

We practise data minimisation — we collect only what the feature needs.

**Parent/guardian account**
- Name, email address, password (stored only as a salted hash — never in plain text).
- Optional: profile avatar and relationship to child.
- **No billing details.** TaskBuddy is free and has no payment path, so we never collect or store
  card numbers or any other payment information (see §7).

**Child profile (created by the parent)**
- Display name or username, age band (not full date of birth where avoidable), optional avatar.
- Task activity: assignments, completions, points/XP, streaks, rewards redeemed.
- **Photo evidence** of completed tasks, if the child uploads a photo. These images are stored
  **privately** and are only accessible to the child's own family via short-lived, authenticated
  links. Location metadata (EXIF/GPS) is stripped from uploads.
- A 4-digit PIN (stored only as a salted hash) used for the child's in-app sign-in.

**Technical / diagnostic**
- Device and app version, IP address, and error diagnostics (via our error-monitoring processor)
  used for security and to keep the service working. We do not use these to build advertising
  profiles of children.

We do **not** collect precise geolocation, contacts, or biometric identifiers.

## 4. How we use information and our legal bases (GDPR)

| Purpose | Legal basis (GDPR) |
|---|---|
| Create/operate accounts, authenticate users, run tasks/points/rewards | Performance of a contract with the parent (Art. 6(1)(b)); for children, the parent's authority + consent (Art. 8) |
| Security, fraud/abuse prevention, account lockout, audit logging | Legitimate interests (Art. 6(1)(f)), balanced against children's rights |
| Transactional emails (verification, security, task/reward notices) | Contract / legitimate interests |
| Product diagnostics and error monitoring | Legitimate interests, minimised and not used to profile children |

We do **not** sell personal data, and we do **not** engage in behavioural advertising or
profiling of children. We do not use children's data to nudge them toward purchases.

## 5. Parental consent and controls

Before a child profile is activated, the parent provides **verifiable parental consent** by
confirming a unique, time-limited link sent to their email address — the method the FTC describes as
**"email plus"**. The parent's consent is recorded, together with the method
used and the policy version consented to, at registration and at each child profile's creation, and
child data collection is blocked until verification completes.

From the parent dashboard, a parent can at any time:
- **Review** all data held about their family;
- **Correct** child profile details;
- **Export** the family's data (machine-readable JSON);
- **Delete** a child profile or the whole family account;
- **Withdraw consent** (which results in deletion of the child's data).

## 6. Data retention and deletion

We retain personal data while the account is active. When a parent deletes a child profile or
the family account, we perform a **hard deletion of personal data within 30 days**, after a short recovery window to guard against accidental deletion. Backups
are rotated and expire on a defined schedule. We may retain limited records where the law requires.

### 6.1 What the 30-day deletion covers

When the retention window closes, for that family we:

- **delete the child's evidence photos** from private object storage, including thumbnails;
- **hard-delete the family record**, which cascades to parents, child profiles, tasks,
  assignments, evidence records, points, rewards, and achievements;
- **redact — not delete — our security logs** (see 6.2).

### 6.2 Logs we keep after deletion, and for how long

Two kinds of record deliberately outlive the deletion above, because deleting them entirely
would destroy the trail we need to investigate abuse of a child's account:

| Record | What we keep | What we remove | Retained for |
|---|---|---|---|
| **Security audit log** | The event skeleton — what happened, when, to which record | All personal identifiers in the event detail | Indefinitely, in redacted form |
| **Email delivery log** | That a message of a given type was sent, and when | The recipient address (replaced with `[redacted]`) | Indefinitely, in redacted form |
| **Server request logs** | Request method, path, status, timing, and **IP address** | — | **30 days** (see 6.3) |

### 6.3 IP addresses in server logs

Our web server records the IP address of each request, which is personal data. These logs are
used only to operate and secure the service — diagnosing errors, and investigating abuse or
attacks. They are held on the application server and are **not** used for profiling or
advertising, and are not shared with third parties except as described in section 7. They are
retained for **30 days** and then discarded automatically.

## 7. How we share information (processors)

We use vetted third-party **processors** who act only on our instructions and may not use the
data for their own purposes:
- **Hosting / database:** OVH, EU region — a single virtual server running the application and its
  PostgreSQL database.
- **Object storage / CDN:** Cloudflare R2 (private evidence storage; public CDN only for
  low-sensitivity avatars).
- **Transactional email:** Zoho ZeptoMail.
- **Error monitoring:** Sentry — configured with personally identifiable information collection
  **switched off** (`sendDefaultPii: false`), on both the server and the mobile app.
- **Payments: none.** TaskBuddy has no paid features, no subscriptions and no in-app purchases. The
  points and cosmetic items in the app are earned in-app and cannot be bought; there is no
  real-money path anywhere in the product.

Each processor is bound by a data-processing agreement. We do not otherwise disclose personal
data except to comply with the law, enforce our terms, or in a business transfer (with notice).

## 8. International transfers

We store personal data in the **EU/EEA**. Where a processor transfers data outside the EEA/UK, we
rely on an appropriate safeguard such as an adequacy decision or Standard Contractual Clauses.

Residency, per processor:

| Processor | What it holds | Region |
|---|---|---|
| **OVH** | Application server and PostgreSQL database | EU |
| **Cloudflare R2** | Children's evidence photos and avatars | **Western Europe (WEUR)** — verified 2026-08-06 |
| **Sentry** | Error reports (no personal data collection enabled) | EU (`ingest.de.sentry.io`) |
| **Zoho ZeptoMail** | Transactional email delivery | Set by the account's data-centre region |

## 9. Security

We protect data with encryption in transit (TLS), hashing of passwords/PINs, private storage for
child evidence photos with short-lived signed access, least-privilege database roles, rate
limiting and account lockout, server-side session revocation, and optional multi-factor
authentication for administrators. No system is perfectly secure; we will notify affected users
and the relevant supervisory authority of a personal-data breach as required by law.

## 10. Your rights

Wherever you live, you or your child may ask us to **access, correct, delete, restrict, object to,
or port** personal data, and to **withdraw consent** at any time. We apply these rights to everyone
rather than only where a law compels it — the mechanism is the same either way, and deciding who gets
them by geography would be both mean and hard to administer.

Parents exercise these rights on behalf of their children. Most are self-served from the parent
dashboard; otherwise contact privacy@gettaskbuddy.com and we will respond within the period the
applicable law requires.

You may also complain to your data-protection authority:

| Where you are | The law | Who to complain to |
|---|---|---|
| **EU/EEA** | GDPR, including Art. 8 on children's consent | Your national supervisory authority |
| **United Kingdom** | UK GDPR, Data Protection Act 2018, and the Age Appropriate Design Code | The Information Commissioner's Office (ICO) |
| **United States** | COPPA, and state laws such as CCPA/CPRA | The Federal Trade Commission, or your state Attorney General |
| **Ghana** | Data Protection Act, 2012 (Act 843) | The Data Protection Commission |

## 11. Cookies and similar technologies

TaskBuddy uses only **strictly necessary** cookies and local storage for sign-in and security. We do
not use advertising or cross-site tracking cookies, and we set no analytics cookies.

The full inventory:

| Name | Where | Purpose | Life |
|---|---|---|---|
| `refreshToken` | Cookie, HttpOnly, Secure, SameSite | Keeps a parent signed in on the website | Until sign-out or expiry |
| Access token | Browser memory only — never written to disk | Authorises each request | Cleared when the tab closes |
| Refresh token (app) | Android Keystore via `expo-secure-store` — not a cookie | Keeps a signed-in phone signed in | Up to 90 days, revocable by the account holder or a parent |
| Family code (app) | Android Keystore | Remembers which family a child's phone belongs to after scanning | Until the device is signed out of that family |

## 12. Changes to this policy

If we make material changes we will update the version number and notify parents in-app or by
email, and where required we will seek renewed consent before the change affects a child's data.

## 13. Contact and complaints

Evolution Prime IT Ltd — privacy@gettaskbuddy.com.
Data Protection Officer / EU-UK representative: **not appointed**.
