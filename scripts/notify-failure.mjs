#!/usr/bin/env node
//
// Email alert sent by systemd OnFailure= when a TaskBuddy unit fails.
//
// Invoked as:  node scripts/notify-failure.mjs <failed-unit-name>
// (the taskbuddy-backup-notify@.service template passes %i).
//
// Reuses the app's nodemailer (hoisted to the root node_modules) and the SMTP
// credentials loaded from /opt/taskbuddy/backup.env via the notify unit's
// EnvironmentFile. The email body includes the failed unit's recent journal so
// you can triage from your inbox without SSHing in first.
//
// Required env (see /opt/taskbuddy/backup.env):
//   SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, ALERT_EMAIL
// Optional env:
//   SMTP_PORT=465  (465 = implicit TLS, matching the backend email service)
import { execSync } from 'node:child_process';
import os from 'node:os';
import nodemailer from 'nodemailer';

const unit = process.argv[2] || 'taskbuddy-backup.service';
const host = os.hostname();

const {
  SMTP_HOST,
  SMTP_PORT = '465',
  SMTP_USER = '',
  SMTP_PASS = '',
  SMTP_FROM = '',
  ALERT_EMAIL,
} = process.env;

if (!SMTP_HOST || !ALERT_EMAIL) {
  console.error('notify-failure: SMTP_HOST and ALERT_EMAIL are required');
  process.exit(1);
}

// Same from-address rule as backend/src/services/email.ts: providers that
// authenticate with an API-key style username (ZeptoMail "emailapikey") send from
// the verified SMTP_FROM; Gmail-style usernames (an email) must send from that
// same address, so fall back to the bare user when they mismatch.
function buildFrom() {
  if (!SMTP_USER.includes('@')) return SMTP_FROM || SMTP_USER;
  const m = SMTP_FROM.match(/<([^>]+)>/);
  const fromEmail = m ? m[1] : SMTP_FROM;
  return fromEmail && fromEmail.toLowerCase() === SMTP_USER.toLowerCase()
    ? SMTP_FROM
    : SMTP_USER;
}

let journal;
try {
  journal = execSync(`journalctl -u ${unit} -n 25 --no-pager`, { encoding: 'utf8' }).trim();
} catch (err) {
  journal = `(could not read journal: ${err?.message})`;
}

const port = parseInt(SMTP_PORT, 10);
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const subject = `[TaskBuddy] ${unit} FAILED on ${host}`;
const text = [
  `The systemd unit "${unit}" entered the failed state on ${host}.`,
  `Time: ${new Date().toISOString()}`,
  '',
  'Recent journal output:',
  '----------------------------------------',
  journal,
  '----------------------------------------',
  '',
  `Investigate: journalctl -xeu ${unit}`,
].join('\n');

try {
  await transporter.sendMail({ from: buildFrom(), to: ALERT_EMAIL, subject, text });
  console.log(`notify-failure: alert sent to ${ALERT_EMAIL} for ${unit}`);
} catch (err) {
  console.error(`notify-failure: failed to send alert: ${err?.message}`);
  process.exit(1);
}
