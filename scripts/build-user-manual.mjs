/**
 * scripts/build-user-manual.mjs — renders the User Manual to PDF.
 *
 *   node scripts/build-user-manual.mjs
 *
 * Words live in `manual-content.mjs`; this file is layout only.
 *
 * Uses `pdf-lib`, already a project dependency driving the branded report exports, rather than a
 * headless browser. A manual is not worth adding a ~300MB build dependency and a CI download step
 * for, and the house PDF style already exists in ExportService — this matches it deliberately.
 *
 * Output is written to `frontend/public/`, which is what makes it downloadable from the parent
 * dashboard, and copied to `docs/` so the repo keeps a readable copy next to the other documents.
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MANUAL } from './manual-content.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// Same palette as ExportService, so the manual and the exported reports look like one product.
const BRAND_BLUE = rgb(0.18, 0.39, 0.91);
const BRAND_DARK = rgb(0.1, 0.1, 0.18);
const BODY = rgb(0.15, 0.15, 0.2);
const MUTED = rgb(0.45, 0.45, 0.52);
const HAIRLINE = rgb(0.88, 0.88, 0.92);
const ROW_TINT = rgb(0.97, 0.97, 0.99);
const NOTE_BG = rgb(0.96, 0.98, 1);
const NOTE_EDGE = rgb(0.55, 0.72, 0.98);
const WARN_BG = rgb(1, 0.97, 0.92);
const WARN_EDGE = rgb(0.95, 0.7, 0.3);
const WHITE = rgb(1, 1, 1);

const MARGIN = 56;
const TOP = 56; // space reserved for the running header
const BOTTOM = 46; // space reserved for the footer

/** Greedy wrap. pdf-lib has no text layout engine, so line breaking is ours to do. */
function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * pdf-lib's WinAnsi encoding rejects characters outside its set, and a crash mid-render over a
 * typographic quote would be a silly way to lose a build. Normalise the few we actually use.
 */
function sanitise(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    // Navigation arrows carry meaning ("Settings > Notifications"). The first build dropped them
    // silently and turned instructions into nonsense ("Settings Notifications").
    .replace(/[→›»]/g, '>')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');
}

class Renderer {
  constructor(doc, fonts, logo) {
    this.doc = doc;
    this.fonts = fonts;
    this.logo = logo;
    this.pageNumber = 0;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(PageSizes.A4);
    const { width, height } = this.page.getSize();
    this.width = width;
    this.height = height;
    this.contentWidth = width - MARGIN * 2;
    this.y = height - TOP;
    this.pageNumber += 1;
    this.drawChrome();
  }

  /** Running header and footer. The logo appears on every page, not just the cover. */
  drawChrome() {
    const { page, fonts } = this;

    if (this.logo) {
      const h = 14;
      const w = (this.logo.width / this.logo.height) * h;
      page.drawImage(this.logo, { x: MARGIN, y: this.height - 34, width: w, height: h });
      page.drawText('TaskBuddy', {
        x: MARGIN + w + 6,
        y: this.height - 30,
        size: 9,
        font: fonts.bold,
        color: BRAND_DARK,
      });
    } else {
      page.drawText('TaskBuddy', { x: MARGIN, y: this.height - 30, size: 9, font: fonts.bold, color: BRAND_DARK });
    }

    page.drawText(`User Manual  |  v${MANUAL.version}`, {
      x: this.width - MARGIN - fonts.regular.widthOfTextAtSize(`User Manual  |  v${MANUAL.version}`, 8),
      y: this.height - 30,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
    page.drawLine({
      start: { x: MARGIN, y: this.height - 40 },
      end: { x: this.width - MARGIN, y: this.height - 40 },
      thickness: 0.7,
      color: HAIRLINE,
    });

    page.drawLine({
      start: { x: MARGIN, y: BOTTOM + 12 },
      end: { x: this.width - MARGIN, y: BOTTOM + 12 },
      thickness: 0.7,
      color: HAIRLINE,
    });
    page.drawText(MANUAL.footer, { x: MARGIN, y: BOTTOM, size: 7.5, font: fonts.regular, color: MUTED });
    const num = String(this.pageNumber);
    page.drawText(num, {
      x: this.width - MARGIN - fonts.regular.widthOfTextAtSize(num, 7.5),
      y: BOTTOM,
      size: 7.5,
      font: fonts.regular,
      color: MUTED,
    });
  }

  /** Break to a new page when `needed` points will not fit above the footer. */
  ensure(needed) {
    if (this.y - needed < BOTTOM + 26) this.newPage();
  }

  text(str, { size = 10, font = this.fonts.regular, color = BODY, indent = 0, gap = 3 } = {}) {
    const maxWidth = this.contentWidth - indent;
    for (const line of wrap(sanitise(str), font, size, maxWidth)) {
      this.ensure(size + gap);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color });
      this.y -= size + gap;
    }
  }

  h1(str) {
    // Never leave a heading alone at the foot of a page.
    this.ensure(64);
    this.y -= 10;
    this.text(str, { size: 19, font: this.fonts.bold, color: BRAND_DARK, gap: 5 });
    this.y -= 5; // clear the descenders, or the accent rule reads as an underline
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 2 },
      end: { x: MARGIN + 54, y: this.y + 2 },
      thickness: 2.5,
      color: BRAND_BLUE,
    });
    this.y -= 12;
  }

  h2(str) {
    this.ensure(48);
    this.y -= 8;
    this.text(str, { size: 13, font: this.fonts.bold, color: BRAND_BLUE, gap: 4 });
    this.y -= 3;
  }

  h3(str) {
    this.ensure(36);
    this.y -= 5;
    this.text(str, { size: 10.5, font: this.fonts.bold, color: BRAND_DARK, gap: 3 });
    this.y -= 1;
  }

  paragraph(str) {
    this.text(str, { size: 10, gap: 3.6 });
    this.y -= 7;
  }

  bullets(items) {
    for (const item of items) {
      this.ensure(16);
      this.page.drawCircle({ x: MARGIN + 5, y: this.y - 6.5, size: 1.7, color: BRAND_BLUE });
      this.text(item, { size: 10, indent: 16, gap: 3.4 });
      this.y -= 3;
    }
    this.y -= 5;
  }

  callout(str, kind) {
    const bg = kind === 'warn' ? WARN_BG : NOTE_BG;
    const edge = kind === 'warn' ? WARN_EDGE : NOTE_EDGE;
    const size = 9.5;
    const inner = this.contentWidth - 24;
    const lines = wrap(sanitise(str), this.fonts.regular, size, inner);
    const boxHeight = lines.length * (size + 3.4) + 16;

    this.ensure(boxHeight + 8);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxHeight,
      width: this.contentWidth,
      height: boxHeight,
      color: bg,
    });
    this.page.drawRectangle({ x: MARGIN, y: this.y - boxHeight, width: 3, height: boxHeight, color: edge });

    let cursor = this.y - 13;
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN + 14, y: cursor, size, font: this.fonts.regular, color: BRAND_DARK });
      cursor -= size + 3.4;
    }
    this.y -= boxHeight + 10;
  }

  table(head, rows, widths) {
    const size = 9;
    const padX = 7;
    const scale = this.contentWidth / widths.reduce((a, b) => a + b, 0);
    const cols = widths.map((w) => w * scale);

    const drawHead = () => {
      this.ensure(24);
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - 17,
        width: this.contentWidth,
        height: 17,
        color: BRAND_BLUE,
      });
      let x = MARGIN;
      head.forEach((cell, i) => {
        this.page.drawText(sanitise(cell), {
          x: x + padX,
          y: this.y - 12,
          size,
          font: this.fonts.bold,
          color: WHITE,
        });
        x += cols[i];
      });
      this.y -= 17;
    };

    drawHead();

    rows.forEach((row, rowIndex) => {
      const cellLines = row.map((cell, i) =>
        wrap(sanitise(cell), this.fonts.regular, size, cols[i] - padX * 2),
      );
      const rowHeight = Math.max(...cellLines.map((l) => l.length)) * (size + 2.6) + 8;

      // A row split across a page break is unreadable; move the whole row and repeat the header.
      if (this.y - rowHeight < BOTTOM + 26) {
        this.newPage();
        drawHead();
      }

      if (rowIndex % 2 === 1) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - rowHeight,
          width: this.contentWidth,
          height: rowHeight,
          color: ROW_TINT,
        });
      }

      let x = MARGIN;
      cellLines.forEach((lines, i) => {
        let cursor = this.y - 11;
        for (const line of lines) {
          this.page.drawText(line, { x: x + padX, y: cursor, size, font: this.fonts.regular, color: BODY });
          cursor -= size + 2.6;
        }
        x += cols[i];
      });

      this.page.drawLine({
        start: { x: MARGIN, y: this.y - rowHeight },
        end: { x: this.width - MARGIN, y: this.y - rowHeight },
        thickness: 0.6,
        color: HAIRLINE,
      });
      this.y -= rowHeight;
    });

    this.y -= 12;
  }
}

async function build() {
  const doc = await PDFDocument.create();
  doc.setTitle('TaskBuddy User Manual');
  doc.setSubject('How to use TaskBuddy for parents, children and administrators');
  doc.setCreator('TaskBuddy');
  doc.setProducer('TaskBuddy');

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  // The logo is the brand mark used across the app and the exported reports.
  let logo = null;
  let logoFull = null;
  try {
    logo = await doc.embedPng(readFileSync(path.join(ROOT, 'frontend/public/logo-mark.png')));
    logoFull = await doc.embedPng(readFileSync(path.join(ROOT, 'frontend/public/logo-full.png')));
  } catch {
    console.warn('[manual] logo not found - building without it');
  }

  // ── Cover ────────────────────────────────────────────────────────────────
  const cover = doc.addPage(PageSizes.A4);
  const { width: cw, height: ch } = cover.getSize();
  cover.drawRectangle({ x: 0, y: ch - 200, width: cw, height: 200, color: BRAND_BLUE });

  if (logoFull) {
    const h = 74;
    const w = (logoFull.width / logoFull.height) * h;
    cover.drawImage(logoFull, { x: (cw - w) / 2, y: ch - 145, width: w, height: h });
  } else {
    const t = 'TaskBuddy';
    cover.drawText(t, {
      x: (cw - fonts.bold.widthOfTextAtSize(t, 40)) / 2,
      y: ch - 130,
      size: 40,
      font: fonts.bold,
      color: WHITE,
    });
  }

  const centre = (text, y, size, font, color) =>
    cover.drawText(sanitise(text), {
      x: (cw - font.widthOfTextAtSize(sanitise(text), size)) / 2,
      y,
      size,
      font,
      color,
    });

  centre(MANUAL.tagline, ch - 300, 20, fonts.regular, BRAND_DARK);
  centre(MANUAL.subtitle, ch - 330, 14, fonts.italic, MUTED);
  cover.drawLine({
    start: { x: MARGIN + 80, y: ch - 356 },
    end: { x: cw - MARGIN - 80, y: ch - 356 },
    thickness: 1,
    color: HAIRLINE,
  });
  centre(
    `Version ${MANUAL.version}  ·  ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
      .replace('·', '-'),
    ch - 382,
    11,
    fonts.regular,
    MUTED,
  );

  // Role cards
  // Parents and children only. Administration is an internal function and has no place in a manual
  // that goes to customers.
  const roles = [
    ['Parent', 'Create tasks and rewards, approve', 'work, manage children, view reports'],
    ['Child', 'Complete tasks, play games, earn', 'points and spend them on rewards'],
  ];
  const gap = 16;
  const cardW = (cw - MARGIN * 2 - gap * (roles.length - 1)) / roles.length;
  roles.forEach((role, i) => {
    const x = MARGIN + i * (cardW + gap);
    const y = ch - 500;
    cover.drawRectangle({ x, y, width: cardW, height: 76, color: ROW_TINT });
    cover.drawRectangle({ x, y: y + 73, width: cardW, height: 3, color: BRAND_BLUE });
    cover.drawText(role[0], { x: x + 12, y: y + 52, size: 12, font: fonts.bold, color: BRAND_DARK });
    cover.drawText(role[1], { x: x + 12, y: y + 34, size: 8, font: fonts.regular, color: BODY });
    cover.drawText(role[2], { x: x + 12, y: y + 22, size: 8, font: fonts.regular, color: BODY });
  });

  centre(MANUAL.footer, 60, 8.5, fonts.regular, MUTED);

  // ── Body ─────────────────────────────────────────────────────────────────
  const r = new Renderer(doc, fonts, logo);

  for (const block of MANUAL.blocks) {
    switch (block.type) {
      case 'h1': r.h1(block.text); break;
      case 'h2': r.h2(block.text); break;
      case 'h3': r.h3(block.text); break;
      case 'p': r.paragraph(block.text); break;
      case 'bullets': r.bullets(block.items); break;
      case 'note': r.callout(block.text, 'note'); break;
      case 'warn': r.callout(block.text, 'warn'); break;
      case 'table': r.table(block.head, block.rows, block.widths); break;
      case 'pagebreak': r.newPage(); break;
      default: throw new Error(`Unknown block type: ${block.type}`);
    }
  }

  const bytes = await doc.save();
  const publicPath = path.join(ROOT, 'frontend/public/TaskBuddy-User-Manual.pdf');
  const docsPath = path.join(ROOT, 'docs/TaskBuddy-User-Manual.pdf');

  writeFileSync(publicPath, bytes);
  copyFileSync(publicPath, docsPath);

  console.log(`[manual] ${doc.getPageCount()} pages, ${(bytes.length / 1024).toFixed(0)} KB`);
  console.log(`[manual] wrote ${path.relative(ROOT, publicPath)}`);
  console.log(`[manual] wrote ${path.relative(ROOT, docsPath)}`);
}

build().catch((err) => {
  console.error('[manual] build failed:', err);
  process.exit(1);
});
