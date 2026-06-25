# TaskBuddy Cleanup (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip every academic / Regional Maritime University reference, remove all literal em dashes, delete academic and junk artifacts, and add the correct legal/licensing files so TaskBuddy reads as a commercial product owned by Evolution Prime IT Ltd.

**Architecture:** Pure repository hygiene and content edits. No runtime code behavior changes. Verification is by grep counts, `git status`, and the existing build/lint/test commands rather than new unit tests (this is mechanical text/file work, not feature work).

**Tech Stack:** Git, Git Bash (`sed`, `grep`), Node workspaces (`npm run build`, `npm run lint`), Jest (backend).

## Global Constraints

- Copyright / ownership holder is **Evolution Prime IT Ltd** (never "Souleymane Camara", never "Regional Maritime University").
- Em dash to remove is **U+2014 (`—`)** only. Box-drawing dashes **U+2500 (`─`)** are LEFT untouched.
- Junk file deletion uses an **exact allowlist**. Never use a wildcard delete in the repo root: legitimate untracked files (`.mcp.json`, `CLAUDE.md`, `skills-lock.json`, `agentdb.rvf`, `agentdb.rvf.lock`, `ruvector.db`) live alongside the junk.
- Do not modify anything under `node_modules/`, `.next/`, `.claude/`, `.agents/`, or `.claude-flow/`.
- Drafted `PRIVACY.md` / `TERMS.md` are templates for lawyer review, and must say so in-document.
- Run all commands from repo root `C:/Users/CamaraSama/Projects/TaskBuddy`.

---

### Task 1: Delete junk and academic artifacts

**Files:**
- Delete (untracked, zero-byte root junk): exact names listed below
- Delete (gitignored academic artifact): `do_not_upload/Chapter_04.pdf`

**Interfaces:**
- Consumes: nothing
- Produces: a clean repo root for later `git status` verification

- [ ] **Step 1: Confirm the junk files are zero-byte before deleting**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
for f in '(typeof' '({' ',' ',+' ',-' '0' '0)' '1' 'Math.max(1' '[r.date' \
  'a.childId' 'a.status' 'challenge_completions)' 'console.log(JSON.stringify(r)))' \
  'file' 'load(page' 'maxAge)' 'minAge' 'new' 'o.trim()).filter(Boolean)' \
  'o.trim()).includes(origin' 'prev' 'set' 'show' 'v' '{' '{,' '{,+' '{,-' '{})'; do
  if [ -f "$f" ]; then printf '%s bytes: %s\n' "$(wc -c < "$f")" "$f"; fi
done
```
Expected: every listed file prints `0 bytes: <name>`. If any is non-zero, STOP and report it (do not delete).

- [ ] **Step 2: Delete the junk files (exact allowlist)**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
for f in '(typeof' '({' ',' ',+' ',-' '0' '0)' '1' 'Math.max(1' '[r.date' \
  'a.childId' 'a.status' 'challenge_completions)' 'console.log(JSON.stringify(r)))' \
  'file' 'load(page' 'maxAge)' 'minAge' 'new' 'o.trim()).filter(Boolean)' \
  'o.trim()).includes(origin' 'prev' 'set' 'show' 'v' '{' '{,' '{,+' '{,-' '{})'; do
  [ -f "$f" ] && rm -- "$f"
done
echo "done"
```
Expected: `done`

- [ ] **Step 3: Delete the academic thesis chapter**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
rm -f -- "do_not_upload/Chapter_04.pdf" && echo "removed"
```
Expected: `removed`

- [ ] **Step 4: Verify the legit untracked files still exist and junk is gone**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
ls -1 .mcp.json CLAUDE.md skills-lock.json agentdb.rvf ruvector.db 2>&1
[ -f '{' ] && echo "JUNK REMAINS" || echo "junk clear"
[ -f 'do_not_upload/Chapter_04.pdf' ] && echo "PDF REMAINS" || echo "pdf clear"
```
Expected: all five legit files listed, then `junk clear`, then `pdf clear`.

- [ ] **Step 5: No commit (deletions were untracked)**

The junk files and `Chapter_04.pdf` were untracked/gitignored, so deleting them
stages nothing and there is NOTHING to commit for this task. Do NOT run
`git add -A` here: this repo has a dirty working tree (105 tracked `.next/`
build artifacts and other pre-existing churn) that `-A` would wrongly sweep into
the commit. Simply confirm and move on. Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git status --short | grep -vE "frontend/.next/|backend/tsconfig.tsbuildinfo|frontend/tsconfig.tsbuildinfo" | head
echo "Task 1 deletions were untracked - no commit needed"
```
Expected: no junk/PDF entries appear (they were never tracked); the only listed
changes are the pre-existing build-artifact churn. No commit is made.

---

### Task 2: Add proprietary LICENSE

**Files:**
- Create: `LICENSE`

**Interfaces:**
- Consumes: nothing
- Produces: `LICENSE` referenced by README footer in Task 5

- [ ] **Step 1: Create the LICENSE file**

Create `LICENSE` with exactly:
```text
Copyright (c) 2026 Evolution Prime IT Ltd. All rights reserved.

TaskBuddy and all associated source code, designs, assets, and documentation
(the "Software") are the proprietary and confidential property of Evolution
Prime IT Ltd.

No part of the Software may be reproduced, distributed, published, sublicensed,
or used to create derivative works, in whole or in part, by any means, without
the prior written permission of Evolution Prime IT Ltd.

Unauthorized copying, modification, distribution, or use of the Software, via
any medium, is strictly prohibited.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

- [ ] **Step 2: Verify no em dash slipped in and file exists**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -c "—" LICENSE; head -1 LICENSE
```
Expected: `0`, then the copyright line naming Evolution Prime IT Ltd.

- [ ] **Step 3: Commit**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add LICENSE && git commit -m "docs: add proprietary LICENSE (Evolution Prime IT Ltd)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: one file changed.

---

### Task 3: Add draft Privacy Policy

**Files:**
- Create: `PRIVACY.md`

**Interfaces:**
- Consumes: nothing
- Produces: `PRIVACY.md` (referenced by TERMS and future app store listings)

- [ ] **Step 1: Create PRIVACY.md**

Create `PRIVACY.md` with:
```markdown
# TaskBuddy Privacy Policy

> DRAFT TEMPLATE. This document is a starting point and is NOT legal advice.
> It must be reviewed by a qualified lawyer before TaskBuddy is published,
> because TaskBuddy is directed at children and is subject to COPPA (US),
> GDPR / GDPR-K (EU), and the UK Children's Code.

**Last updated:** 2026-06-25
**Provider:** Evolution Prime IT Ltd ("we", "us")

## 1. Who this applies to

TaskBuddy is a family task-management application. Parent/guardian accounts are
created by adults. Child profiles are created and managed by a parent/guardian
who provides verifiable consent before any child data is collected.

## 2. Information we collect

- Parent account: name, email address, hashed password.
- Child profile: display name, age band, avatar, points/XP progress, and
  optional photo evidence of completed tasks uploaded by the child.
- Technical: device/app version, and error diagnostics.

## 3. How we use information

To operate the service: authentication, assigning and tracking tasks, awarding
points/XP, sending task and reward notifications, and providing analytics to
the managing parent. We do not sell personal data. We do not show third-party
behavioural advertising to children.

## 4. Parental consent and controls

A parent provides verifiable consent before a child profile is activated.
Parents can review, edit, export, or delete their child's data at any time from
the parent dashboard, or by contacting us.

## 5. Data retention and deletion

We retain data while the account is active. On account deletion we remove
personal data within 30 days, except where retention is legally required.

## 6. Data sharing

We use processors for hosting, storage, email delivery, and payments. Each is
bound by data-protection terms and may not use the data for their own purposes.

## 7. Your rights

Depending on your jurisdiction you may have rights to access, correct, delete,
or port your data, and to withdraw consent. Contact us to exercise them.

## 8. Contact

Evolution Prime IT Ltd, privacy@<your-domain>.
```

- [ ] **Step 2: Verify no em dash and required disclaimers present**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -c "—" PRIVACY.md; grep -c "Evolution Prime IT Ltd" PRIVACY.md; grep -c "DRAFT TEMPLATE" PRIVACY.md
```
Expected: `0`, then a count `>= 1` for each of the other two.

- [ ] **Step 3: Commit**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add PRIVACY.md && git commit -m "docs: add draft Privacy Policy (template, pending legal review)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: one file changed.

---

### Task 4: Add draft Terms of Service

**Files:**
- Create: `TERMS.md`

**Interfaces:**
- Consumes: `PRIVACY.md` (linked from within)
- Produces: `TERMS.md`

- [ ] **Step 1: Create TERMS.md**

Create `TERMS.md` with:
```markdown
# TaskBuddy Terms of Service

> DRAFT TEMPLATE. This document is a starting point and is NOT legal advice.
> It must be reviewed by a qualified lawyer before TaskBuddy is published.

**Last updated:** 2026-06-25
**Provider:** Evolution Prime IT Ltd ("we", "us")

## 1. Acceptance

By creating an account or using TaskBuddy you agree to these Terms and to our
[Privacy Policy](PRIVACY.md). If you do not agree, do not use the service.

## 2. Accounts and eligibility

Parent/guardian accounts must be created by an adult (18+). Parents are
responsible for the child profiles they create and for supervising their use.

## 3. Subscriptions and billing

TaskBuddy offers a free tier and a paid "Family Premium" subscription. Paid
plans renew automatically until cancelled. Web payments are processed by our
payment provider; purchases made through the Apple App Store or Google Play are
governed additionally by those stores' terms and billing.

## 4. Cancellation and refunds

You may cancel at any time; access continues until the end of the paid period.
Refunds follow the policy of the platform through which you purchased.

## 5. Acceptable use

You may not misuse the service, attempt to access other families' data, or
upload unlawful content. We may suspend accounts that violate these Terms.

## 6. Intellectual property

TaskBuddy and all related content are owned by Evolution Prime IT Ltd and are
protected by law. See the LICENSE file. No rights are granted except the
limited right to use the service.

## 7. Disclaimers and liability

The service is provided "as is". To the maximum extent permitted by law,
Evolution Prime IT Ltd is not liable for indirect or consequential damages.

## 8. Changes

We may update these Terms; material changes will be notified in-app or by email.

## 9. Contact

Evolution Prime IT Ltd, support@<your-domain>.
```

- [ ] **Step 2: Verify no em dash and ownership/disclaimer present**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -c "—" TERMS.md; grep -c "Evolution Prime IT Ltd" TERMS.md; grep -c "DRAFT TEMPLATE" TERMS.md
```
Expected: `0`, then counts `>= 1`.

- [ ] **Step 3: Commit**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add TERMS.md && git commit -m "docs: add draft Terms of Service (template, pending legal review)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: one file changed.

---

### Task 5: Rebrand README (remove academic refs + contextual em dash fix)

**Files:**
- Modify: `README.md` (header lines 1-7; TOC item 13 at line 23; section 13 lines 1026-1081; License section lines 1084-1086; footer lines 1090-1091; plus all 98 em dashes throughout)

**Interfaces:**
- Consumes: `LICENSE` (Task 2) for the footer reference
- Produces: a commercial README with zero academic references and zero em dashes

- [ ] **Step 1: Replace the header blockquote (lines 3-5)**

Replace:
```markdown
> **End-of-Programme Project — BSc Information Technology**
> Regional Maritime University, Ghana · February 2026
> **Student:** Souleymane Camara
```
with:
```markdown
> **Family task management, gamified.** Assign chores, reward effort, and watch kids stay motivated.
> A product of Evolution Prime IT Ltd · Available on web, iOS, and Android.
```

- [ ] **Step 2: Rename TOC item 13**

Replace the TOC line `13. [Academic Context](#13-academic-context)` with
`13. [Design Notes](#13-design-notes)`.

- [ ] **Step 3: Rewrite section 13 heading and strip academic framing**

Replace the `## 13. Academic Context` heading with `## 13. Design Notes`.
Delete the entire `### Project Information` table (Programme / Institution /
Project Type / Academic Year / Student) and the entire `### Research Questions`
list. KEEP the `### Key Design Decisions` block and everything after it
(PIN auth, dual currency, co-parent, reward caps, XP system, primary/secondary,
email, real-time, performance) because that is genuine engineering documentation.

- [ ] **Step 4: Replace the License section (lines 1084-1086)**

Replace:
```markdown
This project was developed as an academic submission for Regional Maritime University, Ghana. All rights reserved.
```
with:
```markdown
TaskBuddy is proprietary software. Copyright (c) 2026 Evolution Prime IT Ltd. All rights reserved. See [LICENSE](LICENSE).
```

- [ ] **Step 5: Replace the footer (lines 1090-1091)**

Replace:
```markdown
*TaskBuddy · M10 Complete · All 5 Phases Done · February 2026*
*Souleymane Camara · BSc Information Technology · Regional Maritime University, Ghana*
```
with:
```markdown
*TaskBuddy - a product of Evolution Prime IT Ltd.*
```

- [ ] **Step 6: Fix all remaining em dashes contextually in README**

For each remaining `—` in `README.md`, apply the rule:
- In a heading (e.g. `### Step 1 — Clone the repository`) replace ` — ` with `: ` -> `### Step 1: Clone the repository`.
- In prose/sentences replace ` — ` with `, ` or ` (` ... `)` or `: ` so the sentence still reads naturally (choose per sentence).
Locate them with:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -n "—" README.md
```
Edit each line shown. Box-drawing `─` lines (env-var comment separators) are left untouched.

- [ ] **Step 7: Verify README is clean**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -c "—" README.md
grep -ci "regional maritime\|maritime university\|end-of-programme\|academic\|souleymane\|BSc Information" README.md
```
Expected: `0` then `0`.

- [ ] **Step 8: Commit**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add README.md && git commit -m "docs(readme): rebrand to commercial product, remove academic refs and em dashes

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: one file changed.

---

### Task 6: Remove em dashes from backend source

**Files:**
- Modify: all `*.ts` under `backend/src` that contain `—` (see Task inventory: emails/*, jobs/*, middleware/*, routes/*, services/*, utils/*, index.ts) and `backend/prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing
- Produces: em-dash-free backend that still builds and tests green

- [ ] **Step 1: Bulk-replace em dashes with " - " across backend source**

Almost every backend em dash is in a comment header or milestone tag
(`* emails/base.ts — M9`, `// ─── POST … — Save …`) or a user-facing email
string (`completed — tap to review`); ` - ` reads correctly in all of these.
Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rlZ "—" backend/src backend/prisma/schema.prisma | \
  xargs -0 sed -i 's/ — / - /g; s/—/-/g'
echo "replaced"
```
Expected: `replaced`

- [ ] **Step 2: Sanity-check email user-facing strings read naturally**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rn " - " backend/src/emails | grep -iE "completed|risk|awaits|ignore" | head
```
Expected: lines like `completed - tap to review`, `at risk - no tasks completed today`. If any reads awkwardly, hand-edit that one string to a comma or colon.

- [ ] **Step 3: Verify zero em dashes remain in backend**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rc "—" backend/src backend/prisma/schema.prisma | grep -v ":0" || echo "backend clean"
```
Expected: `backend clean`

- [ ] **Step 4: Build and test the backend**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build:backend && npm -w backend run test
```
Expected: build succeeds; Jest passes (same pass/fail set as before this task; no NEW failures). If a pre-existing failure is unrelated to dashes, note it and continue.

- [ ] **Step 5: Commit**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add backend/src backend/prisma/schema.prisma && git commit -m "refactor(backend): remove em dashes from comments and copy

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: many files changed.

---

### Task 7: Remove em dashes from frontend source

**Files:**
- Modify: all `*.ts`/`*.tsx` under `frontend/src` that contain `—` (app/*, components/*, contexts/*, lib/*)

**Interfaces:**
- Consumes: nothing
- Produces: em-dash-free frontend that still builds

- [ ] **Step 1: Bulk-replace em dashes with " - " across frontend source**

Frontend em dashes are almost all milestone-tag comments
(`// M7 — CR-06:`, `* child/dashboard/page.tsx — Updated M10`); ` - ` is correct.
Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rlZ "—" frontend/src | xargs -0 sed -i 's/ — / - /g; s/—/-/g'
echo "replaced"
```
Expected: `replaced`

- [ ] **Step 2: Check for em dashes inside JSX user-facing text**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rn " - " frontend/src/app frontend/src/components | grep -vE "//|/\*|\*/|\* " | head -20
```
Review the listed lines: if any ` - ` sits inside visible JSX copy and reads awkwardly, hand-edit to a comma/colon. (Most hits will be code, not copy.)

- [ ] **Step 3: Verify zero em dashes remain in frontend**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rc "—" frontend/src | grep -v ":0" || echo "frontend clean"
```
Expected: `frontend clean`

- [ ] **Step 4: Build and lint the frontend**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build:frontend && npm -w frontend run lint
```
Expected: build and lint succeed (no NEW errors introduced by the edits).

- [ ] **Step 5: Commit**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git add frontend/src && git commit -m "refactor(frontend): remove em dashes from comments and copy

Co-Authored-By: claude-flow <ruv@ruv.net>"
```
Expected: many files changed.

---

### Task 8: Final whole-repo verification

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: results of Tasks 1-7
- Produces: confirmation the repo is clean

- [ ] **Step 1: Confirm zero em dashes in all shipped source and docs**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -rl "—" --include="*.ts" --include="*.tsx" --include="*.prisma" \
  --include="*.md" --include="*.json" backend/src frontend/src README.md \
  LICENSE PRIVACY.md TERMS.md 2>/dev/null || echo "ALL CLEAN"
```
Expected: `ALL CLEAN`

- [ ] **Step 2: Confirm zero academic references in shipped files**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
grep -ril "regional maritime\|maritime university\|end-of-programme\|souleymane camara\|bsc information technology" \
  README.md LICENSE PRIVACY.md TERMS.md backend/src frontend/src 2>/dev/null || echo "NO ACADEMIC REFS"
```
Expected: `NO ACADEMIC REFS`

- [ ] **Step 3: Confirm full build passes**

Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
npm run build
```
Expected: both workspaces build successfully.

- [ ] **Step 4: Confirm the cleanup commit series (no blanket add)**

Do NOT run `git add -A` (it would sweep the pre-existing `.next/` build-artifact
churn). Each prior task already committed its own scoped files. Just verify the
series. Run:
```bash
cd "C:/Users/CamaraSama/Projects/TaskBuddy"
git log --oneline -8
```
Expected: recent commits show the cleanup series (LICENSE, PRIVACY, TERMS,
README rebrand, backend em dashes, frontend em dashes).

---

## Self-Review

**Spec coverage** (against `2026-06-25-taskbuddy-commercialization-design.md` section 4 and 7 deliverables):
- Remove school refs from README -> Task 5. PASS
- Delete Chapter_04.pdf -> Task 1 Step 3. PASS
- Delete root junk files -> Task 1 Steps 1-2. PASS
- Em dash contextual removal: README -> Task 5 Step 6; backend -> Task 6; frontend -> Task 7; final sweep -> Task 8 Step 1. PASS
- Proprietary LICENSE (Evolution Prime IT Ltd) -> Task 2. PASS
- Draft PRIVACY.md -> Task 3. PASS
- Draft TERMS.md -> Task 4. PASS
- Box-drawing separators left untouched -> Global Constraints + Task 6 Step 1 only targets `—`. PASS
- Keep do_not_upload/*.md working docs -> not touched by any task. PASS
- Keep TaskBuddy_User_Manual.pdf -> not touched. PASS
- Billing / Capacitor / infra are explicitly out of scope (separate later specs) -> not in this plan, matches spec section 3 and 7. PASS

**Placeholder scan:** `<your-domain>` appears in PRIVACY/TERMS contact lines; these are intentional template fields inside documents explicitly marked DRAFT TEMPLATE for lawyer review, not plan placeholders. All steps contain exact commands/content. PASS.

**Type consistency:** No code interfaces introduced; section/heading names ("Design Notes") used consistently between Task 5 Step 2 (TOC) and Step 3 (heading). PASS.
