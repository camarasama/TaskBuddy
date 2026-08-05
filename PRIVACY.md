# TaskBuddy Privacy Policy

> **DRAFT TEMPLATE. This document is a starting point and is NOT legal advice.**
> It must be reviewed by a qualified lawyer before TaskBuddy is published, because
> TaskBuddy is directed at children and is subject to COPPA (US), GDPR / GDPR-K (EU),
> and the UK Children's Code (Age Appropriate Design Code).
>
> **The bracketed `[...]` decisions have now been drafted** — every one is answered below from what
> the software actually does, so counsel reviews concrete statements rather than filling in blanks.
> Each is marked **(drafted — confirm)**. They remain the provider's and counsel's decisions to
> confirm, and this warning stays until they have. **Removing this notice publishes the document**:
> `marketing/build.mjs` gates `/privacy` and `/terms` on the string "DRAFT TEMPLATE" being absent,
> so deleting these lines is the act of publication, not a tidy-up.

**Version:** 1.1 (draft — bracketed decisions filled in, pending legal review)
**Last updated:** 2026-08-05
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
(see §5). TaskBuddy child profiles are intended for children aged **10–16** *(drafted — confirm)*;
we do not
knowingly create accounts for children below the applicable minimum age without verifiable
parental consent, and where a jurisdiction sets a higher digital-consent age we rely on the
parent's consent under GDPR Article 8.

## 3. Information we collect

We practise data minimisation — we collect only what the feature needs.

**Parent/guardian account**
- Name, email address, password (stored only as a salted hash — never in plain text).
- Optional: profile avatar, relationship to child, billing details (handled by our payment
  processor; we do not store full card numbers).

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
| Billing for paid plans | Contract; legal obligation for tax records |
| Product diagnostics and error monitoring | Legitimate interests, minimised and not used to profile children |

We do **not** sell personal data, and we do **not** engage in behavioural advertising or
profiling of children. We do not use children's data to nudge them toward purchases.

## 5. Parental consent and controls

Before a child profile is activated, the parent provides **verifiable parental consent** by
confirming a unique, time-limited link sent to their email address — the method the FTC describes as
**"email plus"** *(drafted — confirm)*. The parent's consent is recorded, together with the method
used and the policy version consented to, at registration and at each child profile's creation, and
child data collection is blocked until verification completes.

> **For counsel.** "Email plus" is the only accepted COPPA method that requires no additional
> commercial infrastructure (no card transaction, no signed form, no ID check), which is why it is the
> one implemented. The FTC permits it **only where the child's personal information is not disclosed
> to third parties** — TaskBuddy does not disclose child data to third parties other than the
> processors listed in §7, none of which use it for their own purposes. If you judge a stricter
> method necessary, the implementation is deliberately pluggable: a new method is a new entry in the
> `ConsentMethod` registry (`backend/src/services/ConsentService.ts`) and requires no changes at any
> call site. The second "plus" step — a delayed confirmation message to the same parent — is already
> sent on successful verification.

From the parent dashboard, a parent can at any time:
- **Review** all data held about their family;
- **Correct** child profile details;
- **Export** the family's data (machine-readable JSON);
- **Delete** a child profile or the whole family account;
- **Withdraw consent** (which results in deletion of the child's data).

## 6. Data retention and deletion

We retain personal data while the account is active. When a parent deletes a child profile or
the family account, we perform a **hard deletion of personal data within 30 days**
*(drafted — confirm)*, after a short recovery window to guard against accidental deletion. Backups
are rotated and expire on a defined schedule. We may retain limited records where the law requires.

> **For counsel.** 30 days is the software's configured window (`RETENTION_DAYS`, default 30) and
> doubles as the accidental-deletion recovery period. It is a single setting, so a different figure is
> a configuration change rather than a code change — but note it must then be changed in **both** this
> document and the deployment's environment, since nothing enforces that they agree.

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
| **Security audit log** | The event skeleton — what happened, when, to which record | All personal identifiers in the event detail | Indefinitely, in redacted form *(drafted — confirm)* |
| **Email delivery log** | That a message of a given type was sent, and when | The recipient address (replaced with `[redacted]`) | Indefinitely, in redacted form *(drafted — confirm)* |
| **Server request logs** | Request method, path, status, timing, and **IP address** | — | **30 days** *(drafted — confirm)* (see 6.3) |

> **For counsel — the one paragraph here worth your attention.** "Indefinitely, in redacted form" is
> what the software does today: the redaction step strips personal identifiers and nothing
> subsequently purges the rows. The claim rests on the redacted records no longer being personal data,
> which holds only if the redaction is genuine **anonymisation** rather than pseudonymisation. It
> removes direct identifiers but retains the internal record id the event referred to, and that id may
> remain linkable while the surrounding rows exist. If you consider that pseudonymised, indefinite
> retention is not available and a bounded period should replace it — 24 months would cover any
> plausible abuse investigation. That change is a scheduled purge job, not a schema change.
>
> The 30-day figure for request logs matches §6 and the `RETENTION_DAYS` setting.

### 6.3 IP addresses in server logs

Our web server records the IP address of each request, which is personal data. These logs are
used only to operate and secure the service — diagnosing errors, and investigating abuse or
attacks. They are held on the application server and are **not** used for profiling or
advertising, and are not shared with third parties except as described in section 7. They are
retained for **30 days** *(drafted — confirm)* and then discarded automatically.

## 7. How we share information (processors)

We use vetted third-party **processors** who act only on our instructions and may not use the
data for their own purposes *(list drafted — confirm)*:
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

> **For counsel.** The absence of a payment processor is a deliberate product constraint rather than
> a stage of development, and it is load-bearing for two things: the "email plus" consent method in
> §5, and the Play Families declaration. If a paid tier is ever introduced, this section, §5 and the
> Play Data safety declaration all need revisiting together.

## 8. International transfers

We store personal data in the **EU/EEA** *(drafted — confirm)*. Where a processor transfers data
outside the EEA/UK, we rely on an appropriate safeguard such as an adequacy decision or Standard
Contractual Clauses.

> **For counsel — this is the section most likely to need correcting.** What the deployment actually
> does, per processor:
>
> - **OVH** — the server and database are in an EU region. Data at rest stays in the EEA.
> - **Cloudflare R2** — R2 is a global service. Whether objects stay in the EEA depends on the
>   bucket's configured location hint, which must be verified rather than assumed. This is the one to
>   check first, because the objects concerned are **children's photographs**.
> - **Zoho ZeptoMail** — the account's data centre region determines this; Zoho operates EU and
>   non-EU regions.
> - **Sentry** — the project ingests via `ingest.de.sentry.io`, i.e. the **EU** region.
>
> The claim "we store personal data in the EU/EEA" is therefore accurate for OVH and Sentry, and
> unverified for R2 and ZeptoMail. Either confirm both are EU-resident, or soften this sentence to
> "primarily in the EU/EEA" and rely on the SCC wording that follows.

## 9. Security

We protect data with encryption in transit (TLS), hashing of passwords/PINs, private storage for
child evidence photos with short-lived signed access, least-privilege database roles, rate
limiting and account lockout, server-side session revocation, and optional multi-factor
authentication for administrators. No system is perfectly secure; we will notify affected users
and the relevant supervisory authority of a personal-data breach as required by law.

## 10. Your rights

Depending on your jurisdiction (GDPR/UK GDPR, and US state laws such as CCPA/CPRA), you or your
child may have rights to **access, correct, delete, restrict, object to, and port** personal
data, and to **withdraw consent** at any time. Parents exercise these rights on behalf of their
children. Most can be self-served from the parent dashboard; otherwise contact
privacy@gettaskbuddy.com and we will respond within the legally required period. You also have
the right to complain to your data-protection supervisory authority (in the UK, the ICO).

## 11. Cookies and similar technologies

TaskBuddy uses only **strictly necessary** cookies and local storage for sign-in and security. We do
not use advertising or cross-site tracking cookies, and we set no analytics cookies.

The full inventory *(drafted — confirm)*:

| Name | Where | Purpose | Life |
|---|---|---|---|
| `refreshToken` | Cookie, HttpOnly, Secure, SameSite | Keeps a parent signed in on the website | Until sign-out or expiry |
| Access token | Browser memory only — never written to disk | Authorises each request | Cleared when the tab closes |
| Refresh token (app) | Android Keystore via `expo-secure-store` — not a cookie | Keeps a signed-in phone signed in | Up to 90 days, revocable by the account holder or a parent |
| Family code (app) | Android Keystore | Remembers which family a child's phone belongs to after scanning | Until the device is signed out of that family |

> **For counsel.** `refreshToken` is the only cookie the application sets — verified against the
> source, which contains exactly one `res.cookie` call. Everything else above is app-side secure
> storage rather than a cookie, listed here because a reader asking "what is stored on my child's
> device" deserves the whole answer in one place. Under the ePrivacy/PECR analysis all four are
> strictly necessary for a service the user requested, so no consent banner is required — but that
> conclusion depends on nothing else being added later without revisiting this table.

## 12. Changes to this policy

If we make material changes we will update the version number and notify parents in-app or by
email, and where required we will seek renewed consent before the change affects a child's data.

## 13. Contact and complaints

Evolution Prime IT Ltd — privacy@gettaskbuddy.com.
Data Protection Officer / EU-UK representative: **not appointed** *(drafted — confirm)*.

> **For counsel — two appointments to rule in or out, and the second is the likelier of the two.**
>
> **DPO (GDPR Art. 37).** Mandatory where the core activity involves large-scale regular and
> systematic monitoring, or large-scale processing of special-category data. TaskBuddy processes
> children's data, which is sensitive in the ordinary sense but is **not** special-category data under
> Art. 9, and the scale is small. A DPO therefore appears not to be mandatory — but "core activity"
> plus children's data is exactly the combination a regulator reads strictly, so this is worth a
> considered answer rather than an assumed one.
>
> **EU representative (GDPR Art. 27).** This is the more likely obligation. Evolution Prime IT Ltd is
> UK-established, so offering the service to children in the EU triggers Art. 27 unless the processing
> is occasional and low-risk — which processing children's data is not. If EU users are in scope at
> launch, an EU representative is probably required and must be named in this policy.
