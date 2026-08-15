// Build the static marketing site into marketing/dist/.
//
//   node marketing/build.mjs
//
// Always emits index.html + styles.css. Legal pages (/privacy, /terms) are generated from the
// repo's PRIVACY.md and TERMS.md — but ONLY once that source no longer carries its
// "DRAFT TEMPLATE" warning.
//
// That gate is deliberate and load-bearing. Both documents currently say they are not legal
// advice and must be reviewed by a lawyer before publication, specifically because TaskBuddy is
// directed at children and falls under COPPA, GDPR/GDPR-K and the UK Children's Code. Publishing
// them would present unreviewed drafts to parents as binding policy. When the reviewed text
// replaces the drafts, the warning goes with it and these pages start building on their own —
// no code change needed. Do not add a flag to force them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SRC = path.join(HERE, 'src');
const DIST = path.join(HERE, 'dist');

const DRAFT_MARKER = 'DRAFT TEMPLATE';

/** Legal documents to publish, once reviewed. */
const LEGAL = [
  { source: 'PRIVACY.md', out: 'privacy.html', title: 'Privacy Policy', link: '/privacy' },
  { source: 'TERMS.md', out: 'terms.html', title: 'Terms of Service', link: '/terms' },
  /**
   * Required by Google Play. The Data safety form demands a publicly reachable URL that names the
   * app, gives the steps to request deletion, and states what is deleted versus kept — and Play
   * shows the link on the store listing, so it has to stand on its own for someone who has already
   * uninstalled and cannot reach the in-app control.
   *
   * It carries no DRAFT TEMPLATE gate, unlike the two above: it describes what the software already
   * does rather than making legal commitments, so there is nothing for counsel to clear first.
   */
  { source: 'ACCOUNT_DELETION.md', out: 'delete-account.html', title: 'Delete your account', link: '/delete-account' },
];

function layout({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — TaskBuddy</title>
<meta name="theme-color" content="#0ea5e9">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header>
  <div class="wrap nav">
    <a class="brand" href="/"><img class="brand-mark" src="/apple-touch-icon.png" width="34" height="34" alt="" aria-hidden="true"> TaskBuddy</a>
    <nav class="nav-actions">
      <a class="btn btn-primary" href="https://app.gettaskbuddy.com">Get started</a>
    </nav>
  </div>
</header>
<main class="wrap legal">
${body}
</main>
<footer>
  <div class="wrap footer-row">
    <p>© 2026 Evolution Prime IT Ltd</p>
  </div>
</footer>
</body>
</html>
`;
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// --- always: the landing page, stylesheet + brand assets -----------------------------------
// Static assets are copied verbatim. The favicon set and apple-touch icon are the TaskBuddy
// logo; android-chrome-512 doubles as the og:image referenced by index.html.
const STATIC = [
  'index.html',
  'styles.css',
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
];
for (const file of STATIC) {
  fs.copyFileSync(path.join(SRC, file), path.join(DIST, file));
}

/**
 * `.well-known/security.txt` (RFC 9116), copied separately because it lives in a subdirectory and
 * the loop above is a flat file list.
 *
 * The apex needs its own copy even though `app.` serves one from `frontend/public/`: the two are
 * different origins, and a researcher looking at `gettaskbuddy.com` will not think to try the app
 * subdomain. Both files are identical and both are named in the `Canonical` field, which is what
 * RFC 9116 asks for when one policy covers several hosts.
 */
const WELL_KNOWN = ['security.txt'];
fs.mkdirSync(path.join(DIST, '.well-known'), { recursive: true });
for (const file of WELL_KNOWN) {
  fs.copyFileSync(path.join(SRC, '.well-known', file), path.join(DIST, '.well-known', file));
}

const built = [...STATIC, ...WELL_KNOWN.map((f) => `.well-known/${f}`)];

// --- conditionally: legal pages, once the drafts are replaced -------------------------------
const publishable = [];
const withheld = [];

for (const doc of LEGAL) {
  const sourcePath = path.join(REPO, doc.source);
  if (!fs.existsSync(sourcePath)) {
    withheld.push(`${doc.source} (missing)`);
    continue;
  }
  const md = fs.readFileSync(sourcePath, 'utf8');
  if (md.includes(DRAFT_MARKER)) {
    withheld.push(`${doc.source} (still marked ${DRAFT_MARKER})`);
    continue;
  }
  // Markdown links between the documents point at the .md files; rewrite to their web paths.
  const html = marked.parse(
    md.replace(/\(PRIVACY\.md\)/g, '(/privacy)').replace(/\(TERMS\.md\)/g, '(/terms)'),
  );
  fs.writeFileSync(path.join(DIST, doc.out), layout({ title: doc.title, body: html }));
  publishable.push(doc);
  built.push(doc.out);
}

// Footer links are only added for pages that actually exist — no links to 404s.
if (publishable.length > 0) {
  const links = publishable
    .map((d) => `      <li><a href="${d.link}">${d.title}</a></li>`)
    .join('\n');
  const indexPath = path.join(DIST, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  fs.writeFileSync(
    indexPath,
    index.replace(/(\s*<!-- Privacy and Terms links[\s\S]*?-->)/, `\n${links}`),
  );
}

console.log(`built ${built.length} file(s) into marketing/dist: ${built.join(', ')}`);
for (const w of withheld) {
  console.log(`  withheld: ${w}`);
}
if (withheld.length > 0) {
  console.log('  -> legal pages publish automatically once the reviewed text replaces the drafts.');
}
