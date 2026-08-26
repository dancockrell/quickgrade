/* look.js - eyes for printed and rendered pages.
 *
 *   node tools/look.js <file-or-url> [--out DIR] [--json] [--quiet]
 *
 * Why this exists. Every layout defect found in this project so far was found
 * by a person noticing it, not by a test: writing rules that were 78% white
 * and vanished on a photocopy, a label sitting on top of the bubbles above it,
 * an option whose text was cut off mid-word so the correct answer could not be
 * read. None of those break a script. All of them break the paper.
 *
 * So this looks at what a page actually renders, not at what the source says
 * it should, and it reports five kinds of trouble:
 *
 *   truncated  text cut off by overflow or an ellipsis - worst when it is an
 *              answer a student has to choose between
 *   collision  two elements that both carry ink sitting on top of each other
 *   faint      ink too light to survive a photocopier, on something that
 *              carries meaning rather than decoration
 *   escaped    content outside the page it belongs to
 *   tiny       text below a size a person can comfortably read on paper
 *
 * It writes annotated screenshots with every finding boxed and numbered, and
 * a set of layer images - text alone, rules alone, solids alone - because a
 * collision is often obvious in one layer and invisible in the whole.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ARGS = process.argv.slice(2);
const TARGET = ARGS.find(a => a.charAt(0) !== '-');
const OUT = (function () {
  const i = ARGS.indexOf('--out');
  return i >= 0 ? ARGS[i + 1] : path.join(__dirname, '.look');
})();
const JSON_ONLY = ARGS.indexOf('--json') >= 0;
const QUIET = ARGS.indexOf('--quiet') >= 0;

if (!TARGET) {
  console.log('usage: node tools/look.js <file-or-url> [--out DIR] [--json]');
  process.exit(2);
}

/* Thresholds, each with a reason rather than a taste.
 *
 * PRINT_GREY: a mid grey survives one copy and dies on the third. Anything
 * lighter than this on a line or a glyph is treated as absent on paper.
 * MIN_PT: below about 6pt an adult needs to hold the page closer; a child in
 * an exam room will skip it.
 * OVERLAP_PX: rounding and antialiasing put neighbours within a pixel of each
 * other all the time; two pixels of genuine overlap is a collision. */
const PRINT_GREY = 0.62;
const MIN_PT = 6.0;
const OVERLAP_PX = 2;
/* A fifth of a page with nothing on it is worth mentioning; less is just
 * margin. Reported, never failed: an empty band is a judgement, not a defect. */
const BLANK_FRAC = 0.18;

function url(t) {
  if (/^https?:/i.test(t)) return t;
  return 'file:///' + path.resolve(t).split(path.sep).join('/');
}

/* Everything below runs inside the page. It is one function so the browser
 * side stays in one piece and can be reasoned about on its own. */
function auditInPage(cfg) {
  const out = [];
  const seen = new Set();

  function lum(css) {
    const m = String(css).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s));
    if (p.length > 3 && p[3] === 0) return null;          // transparent
    const f = p.slice(0, 3).map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  function pt(px) { return parseFloat(px) * 0.75; }
  function label(el) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const nm = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
    return nm + (t ? ' "' + t.slice(0, 46) + (t.length > 46 ? '...' : '') + '"' : '');
  }
  function add(kind, el, why, rect, weight) {
    const k = kind + '|' + label(el) + '|' + why;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, why, weight, label: label(el),
      rect: { x: Math.round(rect.left), y: Math.round(rect.top),
              w: Math.round(rect.width), h: Math.round(rect.height) } });
  }

  /* Anything marked noprint is screen furniture - a toolbar, a print button -
   * and judging it by paper rules produces noise, not findings. */
  const all = [...document.querySelectorAll('body *')].filter(el => !el.closest('.noprint'));
  const vis = all.filter(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  /* ---- text that is cut off ---------------------------------------- */
  vis.forEach(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const hiddenX = el.scrollWidth - el.clientWidth > 1;
    const hiddenY = el.scrollHeight - el.clientHeight > 1;
    const clips = /hidden|clip|ellipsis/.test(cs.overflow + cs.overflowX + cs.overflowY + cs.textOverflow);
    if (clips && (hiddenX || hiddenY)) {
      add('truncated', el,
        'text is ' + (hiddenX ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight) +
        'px longer than the space it is given', r, hiddenX ? 3 : 2);
    }
  });

  /* ---- ink too light for paper -------------------------------------- */
  vis.forEach(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      const L = lum(cs.color);
      if (L !== null && L > cfg.PRINT_GREY) {
        add('faint', el, 'text luminance ' + L.toFixed(2) + ' is too light to photocopy', r, 2);
      }
      const size = pt(cs.fontSize);
      /* A letter inside a bubble is a legend, not prose: it lives in a
       * circle a fifth of an inch across and is read once. Only running
       * text is judged on size. */
      const glyphSized = r.width < 30 && r.height < 30;
      if (size < cfg.MIN_PT && !glyphSized) {
        add('tiny', el, 'text is ' + size.toFixed(1) + 'pt', r, 1);
      }
    }
    ['borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor'].forEach(side => {
      const w = parseFloat(cs[side.replace('Color', 'Width')]);
      if (!w) return;
      const L = lum(cs[side]);
      if (L !== null && L > cfg.PRINT_GREY) {
        add('faint', el, side.replace('border', '').replace('Color', '') +
          ' rule at luminance ' + L.toFixed(2) + ' will not survive a copy', r, 2);
      }
      if (w < 0.75) {
        add('faint', el, side.replace('border', '').replace('Color', '') +
          ' rule is ' + w + 'px, thinner than a printer dot', r, 2);
      }
    });
  });
  return out;
}

/* Collisions get their own pass because the interesting comparison is between
 * elements that are not related to each other. A child sitting inside its
 * parent is not a collision; a label sitting on top of a bubble is. */
function collisionsInPage(cfg) {
  const out = [];

  function inky(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const hasEdge = ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth']
      .some(w => parseFloat(cs[w]) > 0);
    const filled = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    return hasText || hasEdge || filled;
  }
  function label(el) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const nm = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
    return nm + (t ? ' "' + t.slice(0, 34) + (t.length > 34 ? '...' : '') + '"' : '');
  }

  const els = [...document.querySelectorAll('body *')].filter(el => !el.closest('.noprint'))
    .filter(inky).map(el => ({
    el, r: el.getBoundingClientRect(), cs: getComputedStyle(el)
  })).filter(x => x.r.width > 0 && x.r.height > 0 && x.r.width < 3000);

  /* Only compare things that carry their own text or edge, and skip any pair
   * where one contains the other. Sorting by top keeps the sweep cheap. */
  els.sort((a, b) => a.r.top - b.r.top);
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (b.r.top > a.r.bottom) break;                       // no later pair can touch
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox <= cfg.OVERLAP_PX || oy <= cfg.OVERLAP_PX) continue;
      /* One box wholly inside another is deliberate placement, not a
       * collision: a caption inside its frame, a filled bubble inside its
       * outline. Absolutely positioned siblings do this constantly and the
       * DOM gives no hint, so containment has to be judged geometrically. */
      const aInB = a.r.left >= b.r.left - 1 && a.r.right <= b.r.right + 1 &&
                   a.r.top >= b.r.top - 1 && a.r.bottom <= b.r.bottom + 1;
      const bInA = b.r.left >= a.r.left - 1 && b.r.right <= a.r.right + 1 &&
                   b.r.top >= a.r.top - 1 && b.r.bottom <= a.r.bottom + 1;
      if (aInB || bInA) continue;
      /* Two boxes drawn deliberately on top of each other - a filled bubble
       * inside its outline, say - share a centre. Genuine collisions do not. */
      const acx = a.r.left + a.r.width / 2, acy = a.r.top + a.r.height / 2;
      const bcx = b.r.left + b.r.width / 2, bcy = b.r.top + b.r.height / 2;
      if (Math.abs(acx - bcx) < 2 && Math.abs(acy - bcy) < 2) continue;
      const r = { left: Math.max(a.r.left, b.r.left), top: Math.max(a.r.top, b.r.top),
                  width: ox, height: oy };
      out.push({ kind: 'collision', weight: 3,
        why: 'overlaps by ' + Math.round(ox) + 'x' + Math.round(oy) + 'px',
        label: label(a.el) + '  ==  ' + label(b.el),
        rect: { x: Math.round(r.left), y: Math.round(r.top),
                w: Math.round(r.width), h: Math.round(r.height) } });
    }
  }
  return out;
}

/* Anything sitting outside the page it belongs to will be cut off by the
 * printer, and nobody sees it until the copies come back. */
function escapedInPage(sel) {
  const pages = [...document.querySelectorAll(sel)];
  const out = [];
  pages.forEach((pg, i) => {
    const pr = pg.getBoundingClientRect();
    [...pg.querySelectorAll('*')].forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const over = Math.max(pr.left - r.left, r.right - pr.right,
                            pr.top - r.top, r.bottom - pr.bottom);
      if (over > 2) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        out.push({ kind: 'escaped', weight: 3,
          why: 'sits ' + Math.round(over) + 'px outside page ' + (i + 1),
          label: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') +
                 (t ? ' "' + t + '"' : ''),
          rect: { x: Math.round(r.left), y: Math.round(r.top),
                  w: Math.round(r.width), h: Math.round(r.height) } });
      }
    });
  });
  return out;
}


/* Large areas where a reader would see nothing.
 *
 * Borrowed from desktop-vision-rig, which added it after a session lost an
 * evening to a thousand-pixel column rendering as black nothing while every
 * assertion passed. The insight transfers exactly: every check here answers
 * "does the element exist", and none of them answer "would anybody see
 * anything in this part of the page". On paper the cost is not a broken render
 * but a wasted side, which a school pays for by the copy.
 *
 * Judged from element boxes rather than pixels, because at this point the DOM
 * is the truth about what was laid out and pixels would only add sampling
 * error.
 */
/* page.evaluate passes exactly one argument, so both arrive in one object. */
function blankInPage(arg) {
  const sel = arg.sel, cfg = arg.cfg;
  const out = [];
  const pages = [...document.querySelectorAll(sel)];
  pages.forEach((pg, pi) => {
    const pr = pg.getBoundingClientRect();
    if (pr.width < 50 || pr.height < 50) return;
    const COLS = 12, ROWS = 16;
    const cw = pr.width / COLS, ch = pr.height / ROWS;
    const filled = new Uint8Array(COLS * ROWS);

    [...pg.querySelectorAll('*')].forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      const hasEdge = ['borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth']
        .some(w => parseFloat(cs[w]) > 0);
      const solid = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
      if (!hasText && !hasEdge && !solid) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      /* A hollow element puts its ink on its perimeter, not across its area.
       * A ruled border, a writing box, a panel outline: the middle of one is
       * empty paper and should be counted as such. Treating them as solid was
       * marking every cell of a nearly blank page as occupied, because the
       * page border alone covers the whole grid. */
      const hollow = !hasText && !solid && hasEdge;
      const bw = {
        t: parseFloat(cs.borderTopWidth) || 0, b: parseFloat(cs.borderBottomWidth) || 0,
        l: parseFloat(cs.borderLeftWidth) || 0, r: parseFloat(cs.borderRightWidth) || 0
      };
      const bands = hollow
        ? [{ x0: r.left, y0: r.top, x1: r.right, y1: r.top + Math.max(bw.t, 1) },
           { x0: r.left, y0: r.bottom - Math.max(bw.b, 1), x1: r.right, y1: r.bottom },
           { x0: r.left, y0: r.top, x1: r.left + Math.max(bw.l, 1), y1: r.bottom },
           { x0: r.right - Math.max(bw.r, 1), y0: r.top, x1: r.right, y1: r.bottom }]
        : [{ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }];
      for (let c = 0; c < COLS; c++) {
        for (let rw = 0; rw < ROWS; rw++) {
          const x0 = pr.left + c * cw, y0 = pr.top + rw * ch;
          const hit = bands.some(bd =>
            bd.x0 < x0 + cw && bd.x1 > x0 && bd.y0 < y0 + ch && bd.y1 > y0);
          if (hit) filled[c * ROWS + rw] = 1;
        }
      }
    });

    /* The largest empty rectangle, not the tallest empty row.
     *
     * A band of rows only counts as empty if nothing occupies any column in
     * it, so an identity block sitting in the right-hand quarter hides two
     * inches of white across the rest of the width. The page 5 of a real
     * answer sheet reported nothing at all on the row test while a quarter of
     * the sheet was visibly bare. This is the standard largest-rectangle-in-a
     * -histogram sweep, one row at a time. */
    let best = { area: 0, c0: 0, r0: 0, cw: 0, rh: 0 };
    const heights = new Array(COLS).fill(0);
    for (let rw = 0; rw < ROWS; rw++) {
      for (let c = 0; c < COLS; c++) {
        heights[c] = filled[c * ROWS + rw] ? 0 : heights[c] + 1;
      }
      const stack = [];
      for (let c = 0; c <= COLS; c++) {
        const hgt = c === COLS ? 0 : heights[c];
        let start = c;
        while (stack.length && stack[stack.length - 1].h >= hgt) {
          const top = stack.pop();
          const area = top.h * (c - top.c);
          if (area > best.area) {
            best = { area, c0: top.c, r0: rw - top.h + 1, cw: c - top.c, rh: top.h };
          }
          start = top.c;
        }
        stack.push({ c: start, h: hgt });
      }
    }
    const frac = best.area / (COLS * ROWS);
    if (frac >= (cfg.BLANK_FRAC || 0.18)) {
      out.push({ kind: 'blank', weight: 1,
        why: Math.round(frac * 100) + '% of page ' + (pi + 1) + ' is one empty block, about ' +
             (best.cw * cw / 96).toFixed(1) + 'in by ' + (best.rh * ch / 96).toFixed(1) + 'in',
        label: 'page ' + (pi + 1) + ', nothing a reader would see here',
        rect: { x: Math.round(pr.left + best.c0 * cw), y: Math.round(pr.top + best.r0 * ch),
                w: Math.round(best.cw * cw), h: Math.round(best.rh * ch) } });
    }
  });
  return out;
}

/* ------------------------------------------------------------------ run */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1500 },
                                       deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(url(TARGET), { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);                       // webfonts settle

  const cfg = { PRINT_GREY, MIN_PT, OVERLAP_PX, BLANK_FRAC };
  const pageSel = await page.evaluate(() => {
    for (const s of ['.page', '.sheet', '.slide', 'body']) {
      if (document.querySelectorAll(s).length) return s;
    }
    return 'body';
  });

  let findings = [];
  findings = findings.concat(await page.evaluate(auditInPage, cfg));
  findings = findings.concat(await page.evaluate(collisionsInPage, cfg));
  findings = findings.concat(await page.evaluate(escapedInPage, pageSel));
  findings = findings.concat(await page.evaluate(blankInPage, { sel: pageSel, cfg }));
  findings.sort((a, b) => b.weight - a.weight || a.rect.y - b.rect.y);

  /* ---- annotated screenshot: every finding boxed and numbered ---- */
  await page.evaluate(function (list) {
    const lay = document.createElement('div');
    lay.id = 'look-overlay';
    lay.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:2147483647';
    document.body.appendChild(lay);
    const colour = { collision: '#e11', truncated: '#e11', escaped: '#e11',
                     faint: '#07c', tiny: '#c60', blank: '#0a7' };
    list.forEach(function (f, i) {
      const d = document.createElement('div');
      const c = colour[f.kind] || '#e11';
      d.style.cssText = 'position:absolute;left:' + (f.rect.x - 2 + window.scrollX) +
        'px;top:' + (f.rect.y - 2 + window.scrollY) + 'px;width:' + (f.rect.w + 4) +
        'px;height:' + (f.rect.h + 4) + 'px;border:1.5px solid ' + c +
        ';box-shadow:0 0 0 1px rgba(255,255,255,.7)';
      const tag = document.createElement('div');
      tag.textContent = String(i + 1);
      tag.style.cssText = 'position:absolute;left:-1.5px;top:-13px;background:' + c +
        ';color:#fff;font:700 10px/12px sans-serif;padding:0 3px;border-radius:2px';
      d.appendChild(tag);
      lay.appendChild(d);
    });
  }, findings);
  await page.screenshot({ path: path.join(OUT, 'annotated.png'), fullPage: true });
  await page.evaluate(() => { const e = document.getElementById('look-overlay'); if (e) e.remove(); });

  /* ---- layers: the same page with only one kind of ink at a time ----
   * A label on top of a bubble is invisible in the finished page and obvious
   * the moment the bubbles are removed. */
  const LAYERS = {
    'layer-text': "el => { el.style.borderColor='transparent'; el.style.background='transparent'; }",
    'layer-rules': "el => { el.style.color='transparent'; el.style.background='transparent'; }",
    'layer-solids': "el => { el.style.color='transparent'; el.style.borderColor='transparent'; }"
  };
  for (const [name, fn] of Object.entries(LAYERS)) {
    await page.evaluate(function (src) {
      window.__lookSaved = [];
      const f = eval(src);
      document.querySelectorAll('body *').forEach(el => {
        window.__lookSaved.push([el, el.getAttribute('style') || '']);
        f(el);
      });
    }, fn);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    await page.evaluate(() => {
      (window.__lookSaved || []).forEach(([el, s]) => {
        if (s) el.setAttribute('style', s); else el.removeAttribute('style');
      });
    });
  }

  await browser.close();

  const report = { target: TARGET, pageSelector: pageSel, pageErrors,
                   counts: {}, findings };
  findings.forEach(f => { report.counts[f.kind] = (report.counts[f.kind] || 0) + 1; });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1), 'utf8');

  if (JSON_ONLY) { console.log(JSON.stringify(report, null, 1)); }
  else {
    console.log('looking at ' + TARGET + '  (pages matched by "' + pageSel + '")\n');
    if (!findings.length) console.log('  nothing to report');
    const show = QUIET ? findings.filter(f => f.weight >= 3) : findings;
    show.forEach((f, i) => {
      console.log('  ' + String(findings.indexOf(f) + 1).padStart(3) + '  ' +
        f.kind.padEnd(10) + f.why);
      console.log('       ' + f.label);
    });
    const c = report.counts;
    console.log('\n  ' + Object.keys(c).map(k => c[k] + ' ' + k).join(', ') +
                (findings.length ? '' : ''));
    if (pageErrors.length) console.log('  page errors: ' + pageErrors.slice(0, 2).join(' | '));
    console.log('  images in ' + path.resolve(OUT));
  }
  process.exit(findings.some(f => f.weight >= 3) ? 1 : 0);
})();
