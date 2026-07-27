/**
 * scripts/manual-content.mjs — the source of truth for the TaskBuddy User Manual.
 *
 * Kept separate from the renderer so the words can be edited without touching layout code.
 *
 * **Everything here must describe something a user can actually find in the product.** While writing
 * v2 two features were deliberately left out for exactly that reason: avatar cosmetics (the API
 * exists, no screen calls it) and public report-card share links (not built — an unauthenticated URL
 * exposing a child's stats needs legal sign-off). A manual that documents a screen nobody can reach
 * is worse than one that omits it: the reader assumes they are the problem.
 *
 * Block types: h1, h2, h3, p, bullets, table, note, warn, pagebreak.
 */

export const MANUAL = {
  version: '2.0',
  // Business product, not a university submission. No institution, no programme, no student.
  tagline: 'Family Task Management',
  subtitle: 'Complete User Manual',
  footer: 'TaskBuddy — Family Task Management',
  blocks: [
    // ─── 1. Introduction ──────────────────────────────────────────────────────
    { type: 'h1', text: '1. Introduction' },
    {
      type: 'p',
      text:
        'TaskBuddy is a family task management app for households with children aged 10 to 16. ' +
        'It turns everyday chores into a game — points, XP, levels, streaks, badges and rewards — ' +
        'while giving parents complete visibility and control over what their children see and earn.',
    },

    { type: 'h2', text: '1.1 How it works' },
    {
      type: 'p',
      text:
        'Parents create tasks and assign them to their children. A child completes the task in real ' +
        'life, submits it (with a photo if the task requires one), and a parent approves or returns ' +
        'it. On approval the child receives XP and Points automatically. The cycle repeats daily, ' +
        'building habits and streaks over time.',
    },

    { type: 'h2', text: '1.2 The two currencies' },
    {
      type: 'p',
      text:
        'TaskBuddy keeps progression and spending separate, so a child who saves for a big reward ' +
        'never has to choose between levelling up and buying something:',
    },
    {
      type: 'bullets',
      items: [
        'XP (Experience Points) — earned on approval, fills the level bar, and can never be spent.',
        'Points — also earned on approval, and spent in the reward shop. Level-up bonuses, game ' +
          'rewards and teamwork bonuses are all added here.',
      ],
    },
    {
      type: 'note',
      text:
        'Every points movement is written to a ledger. If a balance ever looks wrong, the Points ' +
        'Ledger report (R-02) shows exactly where each point came from and went.',
    },

    { type: 'h2', text: '1.3 Getting to the app' },
    {
      type: 'p',
      text:
        'TaskBuddy runs in any modern browser on phones, tablets and computers. It is also an ' +
        'installable app: on a phone, open it in your browser and choose "Add to Home Screen" to get ' +
        'an icon, a full-screen view and a badge on the icon when something needs your attention.',
    },
    {
      type: 'note',
      text:
        'Children can start and complete tasks while offline. Those actions queue on the device and ' +
        'send automatically once the connection returns — nothing is lost on a patchy signal.',
    },

    { type: 'h2', text: '1.4 Who does what' },
    {
      type: 'table',
      head: ['Role', 'What they can do'],
      widths: [90, 400],
      rows: [
        ['Parent', 'Create tasks and rewards, approve work, manage children, view reports and settings'],
        ['Co-parent', 'The same as a parent. Invited by email; both parents share equal access'],
        ['Child', 'Complete tasks, play games, earn and spend points, collect badges'],
        ['Admin', 'Platform-wide oversight across all families. Not a member of any family'],
      ],
    },

    { type: 'pagebreak' },

    // ─── 2. Parent ────────────────────────────────────────────────────────────
    { type: 'h1', text: '2. Parent Guide' },
    {
      type: 'p',
      text:
        'As a parent you control everything your family sees: the tasks, the rewards, the settings, ' +
        'and when your children are allowed to be interrupted by notifications.',
    },

    { type: 'h2', text: '2.1 Creating your family account' },
    {
      type: 'bullets',
      items: [
        'Choose "Get started" on the home page and enter your name, email, password and family name.',
        'A memorable family code is generated for you (for example MEGA-VIPER-8481). Your children ' +
          'use it to log in. You can view or regenerate it any time in Settings.',
        'Verify your email address using the link we send you.',
        'A short setup guide then walks you through adding a child, creating your first task and ' +
          'approving it, so you see the whole cycle before you rely on it.',
      ],
    },
    {
      type: 'warn',
      text:
        'Parent sessions end when you close the browser, for security. Children\'s sessions persist ' +
        'so they are not locked out of their own chores.',
    },

    { type: 'h2', text: '2.2 Parental consent (required before adding a child)' },
    {
      type: 'p',
      text:
        'Because TaskBuddy holds data about children, a verified parental consent record is required ' +
        'before you can add one. Go to Settings or follow the prompt, confirm your consent, and click ' +
        'the link in the email we send. Adding a child is blocked until this is complete.',
    },
    {
      type: 'note',
      text:
        'This applies to every family, including existing ones. It is a one-off step per family and ' +
        'exists so we can show, not just claim, that a parent agreed.',
    },

    { type: 'h2', text: '2.3 The parent dashboard' },
    {
      type: 'bullets',
      items: [
        'Approvals waiting for you, shown first — a child cannot progress until you act.',
        'A card per child: level, XP bar, points balance, current streak, and a traffic light showing ' +
          'whether they are on track, slipping, or stalled.',
        'Their current goal, if they are saving towards a reward, and how close they are.',
        'How many rewards each child has added to their wishlist.',
        'Recent comments on tasks, so a question does not sit unanswered.',
        'The notification bell, with an unread count.',
        'A link to download this manual.',
      ],
    },

    { type: 'h2', text: '2.4 Managing children' },
    {
      type: 'bullets',
      items: [
        'Add a child from Children > Add child: name, date of birth and a 4-digit PIN. No email needed.',
        'Open a child to edit their details, reset their PIN, set quiet hours, or download a monthly ' +
          'report card.',
        'Removing a child archives them. Their task history and points record are preserved.',
      ],
    },

    { type: 'h2', text: '2.5 Creating tasks' },
    {
      type: 'bullets',
      items: [
        'Tasks > Create task. Give it a title, description and points value; the difficulty is set ' +
          'from the points automatically.',
        'Choose Primary (must-do) or Secondary (bonus). Secondary tasks unlock for a child only once ' +
          'their primary tasks for the day are done.',
        'Optionally set a start time, an estimated duration and a due date.',
        'Assign it to one or more children.',
      ],
    },
    { type: 'h3', text: 'Starting from a template' },
    {
      type: 'p',
      text:
        'If you would rather not start from a blank form, choose "Browse ideas" to pick from a library ' +
        'of ready-made chores grouped into packs by age and room. Picking one fills the form; you can ' +
        'change anything before saving. Applying a whole pack adds every task in it to your library.',
    },
    { type: 'h3', text: 'Team-up tasks' },
    {
      type: 'p',
      text:
        'Tick "Team-up task" and assign two or more children to make one job a shared effort. Each ' +
        'child still earns the full points for the task — the teamwork bonus is paid on top, to ' +
        'everyone, once every member has been approved. Nobody earns less for co-operating, and ' +
        'nobody is rewarded for going last.',
    },
    { type: 'h3', text: 'Limits and clashes' },
    {
      type: 'bullets',
      items: [
        'Each child can hold a maximum of 3 active assignments, and only 1 primary at a time. This is ' +
          'a deliberate focus guard, not a technical limit.',
        'If a new task overlaps something already scheduled for that child, you are shown a timeline ' +
          'of the clash and can adjust or proceed anyway.',
        'Tasks can repeat daily, weekly, on weekdays or at weekends. New instances are generated ' +
          'automatically each night.',
      ],
    },

    { type: 'h2', text: '2.6 Approving work' },
    {
      type: 'p',
      text:
        'When a child submits a task you receive a push notification straight away, and an email. ' +
        'Open the approval screen from either, or from the dashboard.',
    },
    {
      type: 'bullets',
      items: [
        'Review the photo evidence if the task required it.',
        'Approve — the child receives their XP and Points immediately, and any level-up, badge, ' +
          'streak or team bonus is applied at the same moment.',
        'Or return it with written feedback. The child sees your note and can fix it and resubmit.',
      ],
    },
    {
      type: 'note',
      text:
        'If a co-parent has already dealt with a submission, the screen tells you who handled it ' +
        'rather than showing an error.',
    },

    { type: 'h2', text: '2.7 Rewards' },
    {
      type: 'bullets',
      items: [
        'Rewards > Create reward, or "Browse ideas" for ready-made suggestions ordered by what ' +
          'families actually redeem — with your own family\'s history counting most.',
        'Set the points cost, how many times each child may claim it, and an optional household-wide ' +
          'cap and expiry date.',
        'A collaborative reward can be funded by several children pooling points towards one goal.',
        'When a child redeems something, you get a notification. Mark it fulfilled once you have ' +
          'actually delivered it.',
      ],
    },
    { type: 'h3', text: 'Who receives a collaborative reward' },
    {
      type: 'p',
      text:
        'You choose the rule when you create it: Shared (the family — right for a film night or a day ' +
        'out) or Parent\'s choice (you nominate one child when it is funded, for something only one ' +
        'person can have). Contributions are never refunded silently; the reward appears in your ' +
        'redemption reports either way.',
    },

    { type: 'pagebreak' },

    { type: 'h2', text: '2.8 The family calendar' },
    {
      type: 'p',
      text:
        'Calendar shows the week with your children as columns and days as rows, so you can see who ' +
        'has what on. A warning marks two tasks that overlap for the same child. It is read-only for ' +
        'now — change a task by opening it.',
    },

    { type: 'h2', text: '2.9 Insights' },
    {
      type: 'p',
      text:
        'Insights answers the questions a table of numbers cannot: which days of the week actually ' +
        'work for your family, which tasks are quietly never completed, and whether the points you ' +
        'award have drifted out of step with what your rewards cost.',
    },

    { type: 'h2', text: '2.10 Reports' },
    {
      type: 'p',
      text:
        'Reports gives you eleven family-scoped reports. Each can be filtered by child and date range, ' +
        'and exported to CSV or PDF.',
    },
    {
      type: 'table',
      head: ['Report', 'What it shows'],
      widths: [150, 340],
      rows: [
        ['R-01 Task Completion', 'Completion and approval rates, per child and over time'],
        ['R-02 Points Ledger', 'Every point earned and spent, with a running balance'],
        ['R-03 Reward Redemptions', 'What was claimed, by whom, and whether it was fulfilled'],
        ['R-04 Engagement & Streak', 'Streak lengths, at-risk days, daily activity heatmap'],
        ['R-05 Achievements', 'Which badges each child has unlocked, and when'],
        ['R-06 Family Leaderboard', 'Ranked snapshot by points (weekly / monthly / all-time)'],
        ['R-07 Expiry & Overdue', 'Tasks approaching or past their due date'],
        ['R-11 Task Execution Time', 'Estimated versus actual time, and unusual completions'],
        ['R-12 Games', 'Plays, pass rates and points per game, and each child against the daily cap'],
        ['R-13 Webhook Deliveries', 'Whether your integrations are working, and any auto-disabled'],
      ],
    },
    { type: 'h3', text: 'Monthly report card' },
    {
      type: 'p',
      text:
        'From a child\'s page you can download a one-page PDF for any month: their streaks, badges, ' +
        'growth against the previous month and a note from you. It is designed to be shared with a ' +
        'co-parent or a grandparent.',
    },

    { type: 'h2', text: '2.11 Notifications and quiet hours' },
    {
      type: 'p',
      text:
        'Settings > Notifications controls which emails you receive. Separately, each child has quiet ' +
        'hours: an overnight window and an optional schooltime window on chosen weekdays, during which ' +
        'their device will not buzz.',
    },
    {
      type: 'warn',
      text:
        'Quiet hours are read in your family time zone, so set that first in Settings. Notifications ' +
        'still arrive in the app during a quiet window — they simply do not interrupt. Nothing is ' +
        'delivered late in a burst afterwards.',
    },
    {
      type: 'p',
      text:
        'TaskBuddy also limits itself. Beyond one lifecycle email a day and three a week, further ' +
        'non-essential emails are held back. Account emails — verification, password reset, consent, ' +
        'invitations, security notices — are never held back, and neither is your weekly summary.',
    },

    { type: 'h2', text: '2.12 The weekly summary' },
    {
      type: 'p',
      text:
        'Every Monday morning you receive one email covering the week just gone: what each child ' +
        'finished, points earned and spent, anything waiting on you, and rewards about to expire. It ' +
        'ends with a single suggested next step rather than a list of things to feel behind on.',
    },

    { type: 'h2', text: '2.13 Settings' },
    {
      type: 'bullets',
      items: [
        'Family code — view or regenerate the code your children log in with.',
        'Family time zone — used for quiet hours and schooltime. Set this before you use them.',
        'Streak grace period — extra hours past midnight before a streak is considered broken.',
        'Leaderboard — turn sibling rankings on or off for the whole family.',
        'Daily game points cap — the most a child can earn from games in one day.',
        'Two-factor authentication — add a one-time code from an authenticator app to your sign-in.',
        'Webhooks — send TaskBuddy events to another service such as n8n, Zapier or your own endpoint.',
        'Invite another family — share your referral link; you earn a badge, never points.',
      ],
    },

    { type: 'h2', text: '2.14 Inviting a co-parent' },
    {
      type: 'bullets',
      items: [
        'Settings > Family members > Invite co-parent, and enter their email.',
        'They receive a secure link valid for 7 days.',
        'Once they accept they have equal access: either of you can create, approve and manage.',
        'Only the primary account holder can remove a co-parent.',
      ],
    },

    { type: 'pagebreak' },

    // ─── 3. Child ─────────────────────────────────────────────────────────────
    { type: 'h1', text: '3. Child Guide' },
    {
      type: 'p',
      text:
        'TaskBuddy is your mission hub. Finish tasks, earn XP to level up, collect points to spend on ' +
        'rewards, keep a daily streak going and unlock badges along the way.',
    },

    { type: 'h2', text: '3.1 Logging in' },
    {
      type: 'bullets',
      items: [
        'Open TaskBuddy and choose "Child login".',
        'Enter your family code (ask a parent — they can find it in Settings) and tap Continue.',
        'Enter your username and your 4-digit PIN.',
      ],
    },
    {
      type: 'note',
      text: 'Your session stays active, so you will not have to log in again every time.',
    },

    { type: 'h2', text: '3.2 Your home screen' },
    {
      type: 'bullets',
      items: [
        'Your level badge, XP bar and points balance.',
        'Your streak — how many days in a row you have finished at least one task.',
        'Today\'s tasks, and today\'s daily challenge if there is one.',
        'Your goal: the reward you are saving for and how close you are.',
        'Recent badges you have unlocked.',
      ],
    },

    { type: 'h2', text: '3.3 Doing a task' },
    {
      type: 'bullets',
      items: [
        'Tap a task to open it, and read what is being asked.',
        'Tap Start when you begin, so the time you spend is recorded.',
        'Do the task in real life.',
        'Tap Mark as complete, and add a photo if the task asks for one.',
        'Submit. It moves to "Waiting for approval" until a parent reviews it.',
      ],
    },
    {
      type: 'table',
      head: ['Status', 'What it means'],
      widths: [110, 380],
      rows: [
        ['Pending', 'Assigned to you and waiting to be done'],
        ['In progress', 'You have started it'],
        ['Submitted', 'Waiting for a parent to approve'],
        ['Approved', 'Done — your XP and Points have been added'],
        ['Returned', 'A parent sent it back with feedback. Read it, fix it, resubmit'],
        ['Overdue', 'The due date passed before it was completed'],
      ],
    },
    { type: 'h3', text: 'Primary and bonus tasks' },
    {
      type: 'p',
      text:
        'Primary tasks are the ones that must be done. Bonus tasks unlock once your primary tasks for ' +
        'the day are finished, and you can claim them yourself from the list of available tasks.',
    },
    { type: 'h3', text: 'Team-up tasks' },
    {
      type: 'p',
      text:
        'Some tasks are shared with a brother or sister. Your card shows who is on your team and who ' +
        'still has to finish. You each get the full points for your own work, and everyone gets the ' +
        'teamwork bonus once all of you have been approved.',
    },
    { type: 'h3', text: 'Asking a question' },
    {
      type: 'p',
      text:
        'Every task has a comment thread. If you are not sure what is being asked, leave a comment and ' +
        'a parent will see it.',
    },
    {
      type: 'note',
      text:
        'If you lose signal, you can still start and complete tasks. They are saved on your device and ' +
        'sent automatically when you are back online.',
    },

    { type: 'h2', text: '3.4 XP, levels and streaks' },
    {
      type: 'bullets',
      items: [
        'Every approved task gives you XP based on how hard it was.',
        'When the XP bar fills you level up, get a new badge and a bonus of points.',
        'Your streak counts days in a row with at least one task finished.',
        'Reach 7, 14, 30, 60 or 100 days and you get a celebration.',
        'Keep a long streak going and you earn a streak freeze — it covers one missed day ' +
          'automatically, so one bad day does not undo weeks of work.',
      ],
    },
    {
      type: 'note',
      text:
        'XP can never be spent, and nothing you have earned is ever taken away. Points are the ones ' +
        'you spend.',
    },

    { type: 'h2', text: '3.5 Rewards' },
    {
      type: 'bullets',
      items: [
        'Rewards shows what your parents have put up, and what each one costs.',
        'Rewards you can afford are highlighted; the others show how many more points you need.',
        'Tap the heart on a reward to add it to your wishlist, so your parents know what you actually ' +
          'want.',
        'Set one as your goal and your progress towards it appears on your home screen.',
        'Tap Redeem to claim one. Your points are deducted and a parent is told to deliver it.',
      ],
    },
    {
      type: 'p',
      text:
        'Some rewards are shared: you and your brothers or sisters can each put points in until it is ' +
        'paid for. A reward may also show "Sold out" if the family limit has been reached, or ' +
        '"Expired" if its date has passed.',
    },

    { type: 'h2', text: '3.6 Games' },
    {
      type: 'p',
      text:
        'Games gives you a quick quiz to earn extra points. The questions change every day, so coming ' +
        'back tomorrow gives you a fresh set.',
    },
    {
      type: 'bullets',
      items: [
        'Pick an answer and you are told straight away whether it was right, and which answer was ' +
          'correct if it was not.',
        'You cannot change an answer once it is locked in — so take your time.',
        'Finish the quiz to collect your points.',
        'There is a daily limit on points from games, set by your parents. Once you reach it you can ' +
          'still play, but you will not earn more that day.',
      ],
    },

    { type: 'h2', text: '3.7 Badges, ranking and your week' },
    {
      type: 'bullets',
      items: [
        'Badges unlock automatically when you hit a milestone, with a pop-up when it happens.',
        'Rank shows how you and your brothers and sisters compare — your parents can turn this off, ' +
          'and it is meant as friendly motivation, not pressure.',
        'My Week is a set of cards summarising the week you have just had: what you finished, your ' +
          'best day, your streak, new badges and games played. Look for it at the weekend.',
      ],
    },

    { type: 'pagebreak' },

    // ─── 4. Admin ─────────────────────────────────────────────────────────────
    { type: 'h1', text: '4. Administrator Guide' },
    {
      type: 'p',
      text:
        'The administrator role provides oversight across every family on the platform. Admins do not ' +
        'belong to a family and cannot act inside one on a parent\'s behalf.',
    },
    {
      type: 'warn',
      text:
        'Admin accounts are created manually and are not reachable from the public registration flow. ' +
        'Two-factor authentication can be required for all admin sign-ins.',
    },

    { type: 'h2', text: '4.1 Overview' },
    {
      type: 'bullets',
      items: [
        'Families, users, tasks and completions across the whole platform.',
        'Active, suspended and inactive family counts.',
        'Email delivery in the last 24 hours, sent against failed.',
      ],
    },

    { type: 'h2', text: '4.2 Families and users' },
    {
      type: 'bullets',
      items: [
        'Families lists every registered family; open one to see its members, tasks and family code.',
        'Suspending a family blocks all of its logins and records the reason in the audit log. ' +
          'Reactivating is immediate and is also recorded.',
        'Users searches every account by name or email — useful when investigating a support request.',
      ],
    },

    { type: 'h2', text: '4.3 Achievements and games' },
    {
      type: 'bullets',
      items: [
        'Achievements manages the global badge definitions every family shares. Deleting one never ' +
          'removes a badge a child has already earned.',
        'Games manages the quiz library: create and edit games and their question banks, and check ' +
          'rotation health — whether each game has enough questions to keep serving a fresh set daily.',
      ],
    },

    { type: 'h2', text: '4.4 Funnel' },
    {
      type: 'p',
      text:
        'Funnel shows how new families progress from signing up to their first approved task, and ' +
        'where they stop. Families that never convert stay in the denominator, so the numbers are ' +
        'honest rather than flattering.',
    },

    { type: 'h2', text: '4.5 Audit log' },
    {
      type: 'p',
      text:
        'An immutable record of every significant action. It cannot be edited or deleted. Filter by ' +
        'actor, action type, resource type, family or date range, and export to CSV.',
    },
    {
      type: 'table',
      head: ['Action', 'What it records'],
      widths: [150, 340],
      rows: [
        ['CREATE / UPDATE / DELETE', 'A resource was created, edited or removed'],
        ['APPROVE / REJECT', 'A task completion was approved or returned'],
        ['REDEEM / FULFILL', 'A reward was claimed, or marked as delivered'],
        ['SUSPEND / REACTIVATE', 'A family was suspended or restored by an admin'],
        ['LOGIN / REGISTER', 'A sign-in or a new account'],
        ['INVITE_SENT / ACCEPTED', 'A co-parent invitation was sent or accepted'],
        ['FORCE_RESET', 'An admin forced a password reset'],
      ],
    },
    {
      type: 'note',
      text:
        'An entry with no actor is a scheduled system action — an overnight task expiry or streak ' +
        'sweep. That is expected, not a fault.',
    },

    { type: 'h2', text: '4.6 Emails and security' },
    {
      type: 'bullets',
      items: [
        'Emails shows the delivery history of every message sent, with the failure reason where there ' +
          'is one, and a resend button.',
        'Security surfaces platform-level checks and administrator access controls.',
      ],
    },

    { type: 'h2', text: '4.7 Admin reports' },
    {
      type: 'p',
      text:
        'Admins see the eleven family reports with an added family filter, plus three that only exist ' +
        'at platform level: R-08 Platform Health, R-09 Audit Trail and R-10 Email Delivery.',
    },

    { type: 'pagebreak' },

    // ─── 5. Troubleshooting ───────────────────────────────────────────────────
    { type: 'h1', text: '5. Troubleshooting' },

    { type: 'h2', text: '5.1 Parents' },
    {
      type: 'table',
      head: ['Problem', 'What to do'],
      widths: [180, 310],
      rows: [
        ['I forgot my password', 'Use "Forgot password" on the login page'],
        ['I cannot add a child', 'Parental consent must be confirmed first — check your email for the consent link'],
        ['My child cannot log in', 'Check the family code in Settings, and their username and PIN under Children'],
        ['I regenerated the family code', 'Share the new one. Old codes stop working immediately'],
        ['A task has no photo', 'The child submitted without one. Return the task and ask them to resubmit'],
        ['An email never arrived', 'Check spam, then Settings > Notifications. Non-essential emails are also capped at one a day'],
        ['My child got no notification', 'Check their quiet hours and your family time zone — the alert is still in the app'],
        ['The team bonus was not paid', 'It pays only when every member has been approved, not just submitted'],
        ['Points look wrong', 'Open R-02 Points Ledger — every movement is listed with a running balance'],
      ],
    },

    { type: 'h2', text: '5.2 Children' },
    {
      type: 'table',
      head: ['Problem', 'What to do'],
      widths: [180, 310],
      rows: [
        ['I cannot see bonus tasks', 'Finish your primary tasks for today first'],
        ['My task came back', 'Open it, read the feedback, fix it and resubmit'],
        ['I lost my streak', 'A streak freeze covers one missed day if you have earned one. Your longest streak is always kept'],
        ['A reward says "Sold out"', 'The family limit was reached. Ask a parent if it can be raised'],
        ['My points did not go up', 'Points arrive when a parent approves. Give it a moment, then refresh'],
        ['The game gave me no points', 'You may have reached the daily games limit. It resets tomorrow'],
        ['I answered by accident', 'Answers lock once chosen. The next question is a fresh start'],
        ['My tasks will not submit', 'If you are offline they are saved and sent automatically when you reconnect'],
      ],
    },

    { type: 'h2', text: '5.3 Administrators' },
    {
      type: 'table',
      head: ['Problem', 'What to do'],
      widths: [180, 310],
      rows: [
        ['A family is missing', 'Check the status filter — suspended families are hidden by default'],
        ['An email shows "failed"', 'Open it for the error, then use Resend. Repeated failures mean a mail configuration problem'],
        ['An audit entry has no actor', 'That is a scheduled system action, and is expected'],
        ['A badge did not unlock', 'Badges are evaluated on approval. Check the last approved task'],
        ['A game repeats questions', 'Check rotation health under Games — the bank may be too small for a daily rotation'],
      ],
    },

    { type: 'pagebreak' },

    // ─── 6. Glossary ──────────────────────────────────────────────────────────
    { type: 'h1', text: '6. Glossary' },
    {
      type: 'table',
      head: ['Term', 'Meaning'],
      widths: [150, 340],
      rows: [
        ['XP', 'Earned on approval, fills the level bar, cannot be spent'],
        ['Points', 'Earned on approval, spent in the reward shop'],
        ['Level', 'A rank that rises as the XP bar fills. Each level-up pays bonus points'],
        ['Streak', 'Consecutive days with at least one completed task'],
        ['Streak freeze', 'Earned by keeping a long streak; covers one missed day automatically'],
        ['Grace period', 'Extra hours past midnight that still count towards the previous day'],
        ['Primary task', 'A must-do task. Bonus tasks stay locked until these are done'],
        ['Bonus task', 'An optional task a child can claim once their primary tasks are finished'],
        ['Team-up task', 'One task shared by two or more children, with a bonus once all are approved'],
        ['Family code', 'The memorable code children use to log in'],
        ['Referral link', 'A link that invites a different family to start their own account'],
        ['Co-parent', 'A second adult with equal access to the family account'],
        ['Wishlist', 'Rewards a child has marked as wanted, visible to parents'],
        ['Goal', 'The one reward a child is currently saving towards'],
        ['Collaborative reward', 'A reward several children fund together'],
        ['Quiet hours', 'A window during which notifications will not buzz a child\'s device'],
        ['Schooltime', 'A second quiet window applying only on chosen weekdays'],
        ['Daily challenge', 'A bonus objective offered for one day'],
        ['Badge', 'Unlocked automatically when a child reaches a milestone'],
        ['Report card', 'A shareable one-page monthly PDF summary for one child'],
        ['Webhook', 'A way to send TaskBuddy events to another service you use'],
        ['Audit log', 'An immutable record of every significant action, visible to admins'],
      ],
    },
  ],
};
