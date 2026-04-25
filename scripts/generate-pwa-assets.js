const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const MASTER = path.join(PUBLIC, 'icon-master.png');

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  console.log('Generating PWA icons from', MASTER);
  for (const size of ICON_SIZES) {
    const out = path.join(PUBLIC, `icon-${size}x${size}.png`);
    await sharp(MASTER).resize(size, size).png().toFile(out);
    console.log(`  ✓ icon-${size}x${size}.png`);
  }

  // Shortcut icons
  for (const name of ['icon-tasks.png', 'icon-rewards.png']) {
    const out = path.join(PUBLIC, name);
    await sharp(MASTER).resize(96, 96).png().toFile(out);
    console.log(`  ✓ ${name}`);
  }
}

async function generateScreenshots() {
  console.log('Generating placeholder screenshots…');

  const BG = { r: 31, g: 78, b: 121 }; // #1F4E79

  // Wide — 1920×1080
  const wideOut = path.join(PUBLIC, 'screenshot-wide.png');
  await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: BG },
  })
    .png()
    .toFile(wideOut);
  console.log('  ✓ screenshot-wide.png (1920×1080)');

  // Narrow — 750×1334
  const narrowOut = path.join(PUBLIC, 'screenshot-narrow.png');
  await sharp({
    create: { width: 750, height: 1334, channels: 3, background: BG },
  })
    .png()
    .toFile(narrowOut);
  console.log('  ✓ screenshot-narrow.png (750×1334)');
}

async function verify() {
  const expected = [
    ...ICON_SIZES.map((s) => `icon-${s}x${s}.png`),
    'icon-tasks.png',
    'icon-rewards.png',
    'screenshot-wide.png',
    'screenshot-narrow.png',
  ];
  console.log('\nVerifying files…');
  let ok = true;
  for (const f of expected) {
    const exists = fs.existsSync(path.join(PUBLIC, f));
    console.log(`  ${exists ? '✓' : '✗'} ${f}`);
    if (!exists) ok = false;
  }
  if (ok) console.log('\nAll PWA assets present ✓');
  else { console.error('\nSome files missing!'); process.exit(1); }
}

(async () => {
  await generateIcons();
  await generateScreenshots();
  await verify();
})();
