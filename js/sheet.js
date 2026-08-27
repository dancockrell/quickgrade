/* QuickGrade — sheet.js
 * THE single source of truth for answer-sheet geometry.
 * Both the printable sheet renderer and the camera scanner read from here,
 * so a change to the layout can never desynchronise printing from scanning.
 *
 * Coordinate systems
 *   inches : absolute position on US Letter (8.5 x 11)
 *   u,v    : normalised 0..1 inside the rectangle formed by the four
 *            fiducial-square CENTRES. This is what the homography maps to.
 */
(function (global) {
'use strict';

/* Paper sizes, in inches. Letter is the US default; A4 is the standard almost
 * everywhere else, so the layout derives from the paper rather than assuming
 * 8.5 x 11. Everything below that depends on paper size is recomputed by
 * setPaper() — the fixed numbers are the ones anchored to the top-left. */
var PAPERS = {
  letter: { w: 8.5,   h: 11,     label: 'US Letter (8.5 × 11 in)' },
  a4:     { w: 8.268, h: 11.693, label: 'A4 (210 × 297 mm)' },
  legal:  { w: 8.5,   h: 14,     label: 'US Legal (8.5 × 14 in)' }
};
/* Inset of the ruled registration border from the paper edge. This used to be
 * where the solid corner marks sat, and everything printed had to keep a quiet
 * zone clear of them or it merged with one under threshold. A hairline needs
 * far less room, so the border sits further out and the page gets its margins
 * back. */
var MARGIN = 0.42;
var L = {
  page:  { w: 8.5, h: 11 },
  paper: 'letter',
  /* The registration border: the rectangle the scanner solves the page
   * geometry from. Every other coordinate is relative to it. */
  fid:   { x0: 0.42, y0: 0.42, x1: 8.08, y1: 10.58 },

  /* Nothing may be printed within QUIET inches of the border. Ink that
   * touches it joins the rectangle under threshold and the corner it
   * belongs to stops being a corner. */
  quiet: 0.12,

  titleY: 0.86, subTitleY: 1.06, idHeadX: 5.20, idHeadY: 0.86,
  nameBox:  { x: 0.60, y: 1.26, w: 4.10, h: 0.48 },
  classBox: { x: 0.60, y: 1.82, w: 4.10, h: 0.40 },

  idLabelX: 4.92,
  idX0: 5.56, idPitchX: 0.235, idDigits: 6,   // default; per-test override below
  idY0: 1.34, idPitchY: 0.196,
  codeDigits: 3, pageMax: 10,
  /* gaps from the last row of one block to the first row of the next */
  codeGap: 0.26, pageGap: 0.228,

  contentTop: 3.48, contentTopBase: 3.48, contentBottom: 10.02,
  /* Page 2 onward has no name box and no filling guide above the grid,
   * so it starts higher and carries more questions. */
  /* Clearance below the identity block, for pages that start under it.
   * The start itself is worked out per test by laterTop(), because the block's
   * height depends on how many ID digits the test uses. */
  laterGap: 0.20,
  /* Vertical distance between question rows. */
  rowPitch: 0.255,
  /* Horizontal distance between bubbles in a row. These were one constant,
   * which meant taller rows could not be had without also spreading the
   * bubbles sideways. They default to the same number, so every sheet ever
   * printed lays out identically. */
  bubblePitch: 0.255,
  /* Row height when the questions are printed on the sheet itself: enough
   * for a question and its options beside the bubbles. */
  rowPitchText: 0.62,
  colGap: 0.22, labelW: 0.36, colLeft: 0.60,
  bubbleR: 0.088,        // printed outline radius
  sampleR: 0.052,        // radius actually sampled (stays inside the ring)

  footerY: 10.32, footerX: 0.95, footerW: 6.60,
  wGap: 0.17, wLabelH: 0.20, wLeft: 0.90, wRight: 7.60
};
L.W = L.fid.x1 - L.fid.x0;   // 7.40
L.H = L.fid.y1 - L.fid.y0;   // 9.90
L.aspect = L.W / L.H;        // 0.7475
L.KEY_SID = '999999';

/**
 * Re-derive every paper-dependent measurement. Offsets below are expressed as
 * distances from the fiducial rectangle, chosen so that Letter reproduces the
 * original layout to the digit — previously printed Letter sheets keep
 * scanning identically.
 */
function setPaper(name) {
  var p = PAPERS[name] || PAPERS.letter;
  L.paper = PAPERS[name] ? name : 'letter';
  L.page = { w: p.w, h: p.h };
  L.fid.x0 = MARGIN;         L.fid.y0 = MARGIN;
  L.fid.x1 = p.w - MARGIN;   L.fid.y1 = p.h - MARGIN;
  L.W = L.fid.x1 - L.fid.x0;
  L.H = L.fid.y1 - L.fid.y0;
  L.aspect = L.W / L.H;

  L.idX0      = L.fid.x1 - 2.39;      // right-anchored identity block
  L.idLabelX  = L.idX0 - 0.64;
  L.idHeadX   = L.idX0 - 0.36;
  L.nameBox.w = L.idLabelX - 0.22 - L.nameBox.x;
  L.classBox.w = L.nameBox.w;
  L.contentBottom = L.fid.y1 - 0.43;  // bottom-anchored answer grid
  /* Clear of the foot rule, which is 6pt of solid ink on the bottom edge.
   * At 0.13 the footer was printing on top of it. */
  L.footerY   = L.fid.y1 - 0.28;
  L.footerW   = L.fid.x1 - 0.40 - L.footerX;
  L.wRight    = L.fid.x1 - 0.35;
  return L;
}
/** Paper for a test, defaulting to Letter. */
function paperOf(test) {
  var n = test && test.options && test.options.paper;
  return PAPERS[n] ? n : 'letter';
}
/** Every geometry entry point calls this so renderer and scanner never drift. */
/* Print the questions on the answer sheet itself.
 *
 * The default sheet is deliberately question-free so one master can be
 * photocopied for any test. That is right when the teacher already has a
 * question paper. It is wrong when they do not, because it leaves a student
 * reading one sheet and marking another, and it puts instructions like
 * "fill in the circle" on a page that has no circles.
 *
 * With this on, rows get tall enough to carry the question and its options
 * beside the bubbles, and the grid drops to a single column. Bubble spacing
 * is untouched, so the reader sees exactly the geometry it always did.
 */
function questionsOnSheet(test) {
  return !!(test && test.options && test.options.questionsOnSheet &&
            test.mc && (test.mc.text || []).length);
}
function usePaper(test) {
  setPaper(paperOf(test));
  L.rowPitch = questionsOnSheet(test) ? L.rowPitchText : L.bubblePitch;
  /* A question's wording is drawn above the centre of its row, so the first
   * row needs headroom or it climbs into whatever sits above the grid. */
  L.contentTop = L.contentTopBase + (questionsOnSheet(test) ? L.rowPitchText * 0.5 : 0);
  return L;
}

/** The rightmost x anything may be printed at.
 *
 * Ink that touches the registration border joins it under threshold and the
 * corner it belongs to stops being a corner, so everything printed keeps
 * L.quiet clear of it.
 *
 * This used to subtract the width of a solid corner mark as well, via
 * L.fid.size and a bracket centroid constant. Both went away with the marks,
 * and the expression quietly became NaN: undefined times a number. It set the
 * width of the question text on every sheet, where an invalid CSS width falls
 * back to auto and happens to look right, which is why nothing caught it.
 */
function safeRight() { return L.fid.x1 - L.quiet; }
function u(x) { return (x - L.fid.x0) / L.W; }
function v(y) { return (y - L.fid.y0) / L.H; }
function uv(x, y) { return { u: u(x), v: v(y) }; }
function rect(x, y, w, h) { return { u0: u(x), v0: v(y), u1: u(x + w), v1: v(y + h) }; }

var LETTERS = 'ABCDEFGHIJ';

/* What a student sees inside each bubble.
 *
 * Thai school papers number the choices 1 2 3 4 and tell the student to
 * shade a number; British and American papers letter them A B C D. Getting
 * this wrong is not cosmetic: the paper says "shade 3" and the sheet offers
 * A B C D, and a twelve-year-old under exam conditions has to translate.
 *
 * The scanner reads a bubble by its position in the row and never looks at
 * the glyph, so this is display only and cannot change how anything marks.
 * Indexing works the same for a string or an array, so a test may set
 * options.choiceLabels to '1234' or to ['ก','ข','ค','ง'].
 */
function choiceLabelsOf(test) {
  var c = test && test.options && test.options.choiceLabels;
  if (typeof c === 'string' && c.length) return c;
  if (Array.isArray(c) && c.length) return c;
  return LETTERS;
}

function rowsPerCol() {
  return Math.floor((L.contentBottom - L.contentTop) / L.rowPitch) + 1;
}
function colWidth(choices) { return L.labelW + choices * L.bubblePitch; }
function colsPerPage(choices) {
  var cw = colWidth(choices) + L.colGap;
  return Math.max(1, Math.floor((L.W + L.colGap) / cw));
}
function mcPerPage(choices) { return rowsPerCol() * colsPerPage(choices); }

/* ---------------------------------------------------- identity blocks
 * The ID is 2-6 digits, chosen per test. A class roster number (2 digits) is
 * far quicker and more reliable for a student to bubble than a 6-digit
 * district ID — and unlike a pre-printed name, one master sheet can be
 * photocopied for the whole class.
 * With 6 digits the geometry is byte-identical to the original layout, so
 * previously printed 6-digit sheets keep scanning correctly. */
var ID_DIGIT_CHOICES = [2, 3, 4, 5, 6];

function idDigitsOf(test) {
  var n = test && test.options && test.options.idDigits;
  n = parseInt(n, 10);
  return ID_DIGIT_CHOICES.indexOf(n) >= 0 ? n : L.idDigits;
}
function codeY0(n) { return L.idY0 + (n - 1) * L.idPitchY + L.codeGap; }
/* One row of code marks now sits where three rows of bubbles used to. */
function pageY(n) { return codeY0(n) + L.pageGap; }

/** Bubble centres for the student-ID grid: [row][value] */
function idGrid(n) {
  n = n || L.idDigits;
  var rows = [];
  for (var r = 0; r < n; r++) {
    var row = [];
    for (var d = 0; d < 10; d++) row.push(uv(L.idX0 + d * L.idPitchX, L.idY0 + r * L.idPitchY));
    rows.push(row);
  }
  return rows;
}
/* The test code, as ten marks rather than thirty bubbles.
 *
 * It used to be three rows of ten bubbles with one in each row already
 * filled in. That is a hundred and eighty square millimetres of grid asking a
 * student not to touch it, for a number the machine prints and the machine
 * reads. Worse, it looks exactly like the class-number grid directly above,
 * which a student is supposed to fill in.
 *
 * Ten marks carry 0 to 1023, which covers every three-digit code. They are
 * small, they are on one line, and they do not look like anything anybody is
 * meant to complete.
 */
var CODE_BITS = 10;
/* The page number rides on the same strip.
 *
 * It had a row of its own: ten bubbles with one already filled, sitting under
 * the class-number grid and looking exactly like it, for a number the printer
 * writes and only the scanner reads. Four more marks carry one to sixteen,
 * which is more pages than the sheet allows, and the row goes away. That is
 * ten bubbles off every side of every sheet, and one less row of identity
 * block above the questions.
 */
var PAGE_BITS = 4;
var STRIP_BITS = CODE_BITS + PAGE_BITS;
/* The strip has its own pitch, tighter than a bubble.
 *
 * At bubble spacing fourteen marks are 3.29in wide in an identity block that
 * is 2.39in, so the last four were printed past the right edge of the page and
 * sampled off it: the page number read as zero on every sheet. Nobody has to
 * aim at these, so they can sit closer together than something a student fills
 * in. Thirteen gaps at 0.168in span 2.18in and stay inside the block.
 */
function stripPitch() { return (2.39 - 0.20) / (STRIP_BITS - 1); }
function codeBits(n) {
  n = n || L.idDigits;
  var y = codeY0(n), p = stripPitch(), row = [];
  for (var i = 0; i < STRIP_BITS; i++) row.push(uv(L.idX0 + i * p, y));
  return row;
}
/** Most significant bit first, so the printed strip reads left to right. */
function numToBits(v, n) {
  var out = [];
  v = parseInt(v, 10) || 0;
  for (var i = n - 1; i >= 0; i--) out.push(Math.floor(v / Math.pow(2, i)) % 2);
  return out;
}
function codeToBits(code, pageIdx) {
  return numToBits(code, CODE_BITS).concat(numToBits((pageIdx || 0) + 1, PAGE_BITS));
}
function bitsToCode(bits) {
  var v = 0;
  for (var i = 0; i < Math.min(bits.length, CODE_BITS); i++) v = (v * 2) + (bits[i] ? 1 : 0);
  return v;
}
/** @returns 1-based page, or null when the marks say something impossible. */
function bitsToPage(bits) {
  var v = 0;
  for (var i = CODE_BITS; i < bits.length; i++) v = (v * 2) + (bits[i] ? 1 : 0);
  return v >= 1 && v <= L.pageMax ? v : null;
}
/** Where a page that carries no name box and no filling guide can start.
 *
 * Derived from the identity block rather than written down as a constant. It
 * was 2.72in, which is fine for a two-digit class number and lands on the
 * page-number bubbles for a six-digit one: the block grows downward with every
 * extra digit. The layout inspector caught it as a bubble sitting under a
 * written-question label, which is exactly the collision it was built to see.
 */
function laterTop(n) {
  n = n || L.idDigits;
  /* The strip is the last thing in the identity block now that the page
   * row has gone, so clearance is measured from it. */
  return codeY0(n) + L.bubbleR + L.laterGap;
}
function pageRow(n) {
  n = n || L.idDigits;
  var y = pageY(n), row = [];
  for (var d = 0; d < L.pageMax; d++) row.push(uv(L.idX0 + d * L.idPitchX, y));
  return row;
}

/* ------------------------------------------------------ page planning */
/**
 * layoutTest(test) -> array of page descriptors, each:
 *   { pageNo, mc:[{q, choices:[{u,v}]}], written:[{w, rect:{u0,v0,u1,v1}, label, max}] }
 * `q` and `w` are zero-based indexes into test.mc.key / test.written.
 */
function layoutTest(test) {
  usePaper(test);
  var choices = test.mc.choices || 5;
  var nMc = test.mc.count || 0;
  var written = test.written || [];
  var qOnSheet = questionsOnSheet(test);
  var perPage = qOnSheet ? rowsPerCol() : mcPerPage(choices);
  var rows = rowsPerCol(), cols = qOnSheet ? 1 : colsPerPage(choices);
  var cw = colWidth(choices);
  var qOnSheet = questionsOnSheet(test);
  var pages = [];
  var q = 0;

  /* How many questions go on each page.
   *
   * Filling every page to capacity and letting the last one take what is left
   * gave 12, 13 and 5 for a thirty-question paper: the third side was 42% bare,
   * which the page inspector reported and a school pays for by the copy. Work
   * out how many sides are needed first, then share the questions across them,
   * respecting the fact that page one holds fewer because it also carries the
   * name box and the filling guide.
   */
  function planPages(total) {
    function capacity(pageIdx) {
      var t = pageIdx === 0 ? L.contentTop : laterTop(idDigitsOf(test));
      var r = Math.floor((L.contentBottom - t) / L.rowPitch) + 1;
      return qOnSheet ? r : r * cols;
    }
    var n = 0, left = total;
    while (left > 0) { left -= capacity(n); n++; }
    var plan = [], remaining = total;
    for (var i = 0; i < n; i++) {
      var share = Math.round(remaining / (n - i));
      plan.push(Math.min(share, capacity(i)));
      remaining -= plan[i];
    }
    /* Rounding can leave a question over; give it to the first page with room. */
    for (var j = 0; remaining > 0 && j < n; j++) {
      var room = capacity(j) - plan[j];
      var add = Math.min(room, remaining);
      plan[j] += add; remaining -= add;
    }
    return plan;
  }
  var plan = planPages(nMc);

  while (q < nMc) {
    var mc = [];
    /* Page 1 carries the name box and the filling guide; the pages after
     * it carry neither, so their grid starts higher and holds more. */
    var top = pages.length === 0 ? L.contentTop : laterTop(idDigitsOf(test));
    rows = Math.floor((L.contentBottom - top) / L.rowPitch) + 1;
    perPage = qOnSheet ? rows : rows * cols;
    var take = Math.min(plan[pages.length] || perPage, nMc - q);
    /* Spread the questions evenly rather than filling column 1 to the brim and
     * leaving a four-question stub in column 2. */
    var colsUsed = Math.max(1, Math.min(cols, Math.ceil(take / rows)));
    var rowsUsed = Math.ceil(take / colsUsed);
    for (var i = 0; i < take; i++) {
      var c = Math.floor(i / rowsUsed), r = i % rowsUsed;
      var x0 = L.colLeft + c * (cw + L.colGap);
      var y = top + r * L.rowPitch;
      var ch = [];
      for (var k = 0; k < choices; k++) {
        ch.push(uv(x0 + L.labelW + k * L.bubblePitch + L.bubblePitch / 2, y));
      }
      mc.push({
        q: q + i, row: r, col: c, x: x0, y: y, choices: ch,
        /* the strip of paper this question occupies — cropped and shown to the
         * teacher whenever the read was not clean */
        rect: rect(x0, y - L.bubblePitch * 0.62,
                   qOnSheet ? L.W - (x0 - L.colLeft) : cw,
                   qOnSheet ? L.rowPitch : L.bubblePitch * 1.24)
      });
    }
    pages.push({ pageNo: pages.length + 1, mc: mc, written: [] });
    q += take;
  }

  var per = Math.max(1, Math.min(6, test.options && test.options.wPerPage || 2));
  for (var wi = 0; wi < written.length; wi += per) {
    var group = written.slice(wi, wi + per);
    var n = group.length;
    /* Writing pages carry no name box and no filling guide, so they start
     * where the other later pages start rather than inheriting the position
     * the multiple-choice grid needs on page one. That was leaving two inches
     * of white above the first box on every writing side. */
    var wTop = laterTop(idDigitsOf(test));
    var avail = L.contentBottom - wTop - (n - 1) * L.wGap;
    var each = avail / n;
    var list = [];
    for (var j = 0; j < n; j++) {
      var top = wTop + j * (each + L.wGap);
      var boxTop = top + L.wLabelH;
      var boxH = each - L.wLabelH;
      list.push({
        w: wi + j, label: group[j].label, max: group[j].max,
        labelY: top, x: L.wLeft, y: boxTop, bw: L.wRight - L.wLeft, bh: boxH,
        rect: rect(L.wLeft, boxTop, L.wRight - L.wLeft, boxH)
      });
    }
    pages.push({ pageNo: pages.length + 1, mc: [], written: list });
  }

  if (!pages.length) pages.push({ pageNo: 1, mc: [], written: [] });
  if (pages.length > L.pageMax) pages = pages.slice(0, L.pageMax);
  return pages;
}

/** Fast lookup: which page carries MC question q / written question w. */
function pageIndexFor(pages, kind, idx) {
  for (var i = 0; i < pages.length; i++) {
    var list = kind === 'mc' ? pages[i].mc : pages[i].written;
    for (var j = 0; j < list.length; j++) {
      if ((kind === 'mc' ? list[j].q : list[j].w) === idx) return { page: i + 1, item: list[j] };
    }
  }
  return null;
}

/* ------------------------------------------------- printable renderer */
/* Canonical student id: leading zeros are a printing detail, not identity, so
 * "007" bubbled on a 3-digit sheet and "000007" on a 6-digit one are the same
 * student. Returns '' for blank/zero. */
function normId(s) {
  var d = String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');
  return d;
}
/** The reserved id that means "this is the answer key" — all nines. */
function keySid(n) { return new Array((n || L.idDigits) + 1).join('9'); }
function isKeySid(sid, n) { return !!sid && normId(sid) === keySid(n || L.idDigits); }

function digits(nStr, count) {
  var s = String(nStr == null ? '' : nStr).replace(/\D/g, '');
  while (s.length < count) s = '0' + s;
  return s.slice(-count).split('').map(Number);
}
/* Looked up at call time, not at module load: the teacher can switch
 * language between printing one sheet and the next. */
function T(k, v) { return global.QG.T(k, v); }

function E(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function absDiv(cls, x, y, w, h, inner, style) {
  return '<div class="' + cls + '" style="left:' + x + 'in;top:' + y + 'in;width:' + w +
    'in;height:' + h + 'in;' + (style || '') + '">' + (inner || '') + '</div>';
}
function bubble(x, y, letter, filled) {
  var r = L.bubbleR;
  return '<div class="bub' + (filled ? ' fill' : '') + '" style="left:' + (x - r) + 'in;top:' + (y - r) +
    'in;width:' + (2 * r) + 'in;height:' + (2 * r) + 'in">' + (letter && !filled ? E(letter) : '') + '</div>';
}

var SHEET_CSS = [
'@page{size:%PW%in %PH%in;margin:0}',
'*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
'html,body{margin:0;padding:0;background:#8a8f99;font-family:%FONT%;color:#000}',
'.page{position:relative;width:%PW%in;height:%PH%in;background:#fff;overflow:hidden;',
'  margin:14px auto;box-shadow:0 4px 18px rgba(0,0,0,.35)}',
'@media print{body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}',
'  .page:last-child{page-break-after:auto}.noprint{display:none!important}}',
/* 2.5pt. The detector works on a downscaled copy of the photograph, about 58
     * pixels to the inch, and a hairline came out at six tenths of a pixel and
     * vanished - leaving the paper edge as the only rectangle in the picture,
     * which sits five per cent further out and puts every sample on the wrong
     * bubble. This is an ordinary form rule at a thickness that survives being
     * looked at. */
/* A heavier rule along the foot. Forms do this all the time and nobody
     * reads it as a machine mark, but it is what tells the scanner which end of
     * the page is the bottom. Inferring that from where the ink sits was tried
     * and is not dependable: the heading and name box carry more ink than the
     * identity block, so the page came back upside down. */
    '.logo{position:absolute;object-fit:contain}',
    '.edge{position:absolute;border:3pt solid #222;border-bottom-width:7pt;box-sizing:border-box}',
    '.cmark{position:absolute;background:#000}',
'.bub{position:absolute;border:1.1px solid #1a1a1a;border-radius:50%;font-size:5.6pt;line-height:1;',
'  color:#b9b9b9;text-align:center;display:flex;align-items:center;justify-content:center;background:#fff}',
'.bub.fill{background:#000;border-color:#000}',
'.guide{position:absolute;border:.8px dashed #c4c4c4;border-radius:.07in;background:#fcfcfc}',
'.gbub{position:absolute;border:1.1px solid #1a1a1a;border-radius:50%;background:#fff}',
'.gbub.fill{background:#000;border-color:#000}',
'.gbub.tick{background:linear-gradient(135deg,#999 0 42%,#fff 42%)}',
'.gbub.cross::before,.gbub.cross::after{content:"";position:absolute;left:12%;right:12%;top:46%;',
'  border-top:1.2px solid #333;transform:rotate(45deg)}',
'.gbub.cross::after{transform:rotate(-45deg)}',
'.lbl{position:absolute;font-size:6.6pt;color:#333;display:flex;align-items:center}',
'.qn{position:absolute;font-size:7.4pt;color:#111;display:flex;align-items:center;justify-content:flex-end;',
'  padding-right:.05in;font-weight:600}',
'.box{position:absolute;border:1.1px solid #444;border-radius:.06in;background:#fff}',
'.boxlbl{position:absolute;font-size:7.6pt;color:#333;font-weight:700;letter-spacing:.04em}',
'.hdr{position:absolute;font-family:%FONT%;color:#000}',
'.vmark{position:absolute;border:1.6px solid #111;border-radius:.08in;display:flex;',
'  align-items:center;justify-content:center;font-weight:800;font-size:19pt;color:#111}',
'.rule{position:absolute;border-top:1px solid #999}',
/* Ruled lines a student can actually see.
     * These were .6px dotted #c8c8c8: sub-pixel at print resolution and 78%
     * white, so on the one master that gets photocopied for the class they
     * came out as nothing at all. A writing box with no visible rule is a
     * blank rectangle, and students write crooked or not at all. Dark enough
     * to survive a third-generation copy, light enough to sit under pencil. */
    '.writeline{position:absolute;border-top:1px dotted #777}',
    '.qtext{position:absolute;color:#111}',
    '.qstem{font-size:8.4pt;line-height:1.16}',
    '.qopts{display:grid;grid-template-columns:1fr 1fr;gap:.01in .10in;margin-top:.02in;font-size:7.6pt;line-height:1.15}',
    '.qopts span{min-width:0}',
'.toolbar{position:sticky;top:0;background:#111;color:#fff;padding:10px 14px;z-index:9;display:flex;gap:10px;align-items:center}',
'.toolbar button{background:#22c07a;color:#04240f;border:0;border-radius:7px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}',
'.toolbar span{font-size:12px;opacity:.85}'
].join('\n');

/**
 * renderPage(test, pages, pageIdx, who)
 *   who = { sid, name, cls, prefill:bool, keyMode:bool }
 */
function renderPage(test, pages, pageIdx, who) {
  usePaper(test);
  var pg = pages[pageIdx], n = pages.length;
  /* The title, the name and class boxes and the filling guide belong on
   * the first page only. A student writes their name once, reads how to
   * fill a bubble once, and the handwriting crop is taken from page 1.
   * Repeating all of it on every page spends an inch and a half of paper
   * per side to tell them something they already did. */
  var first = pageIdx === 0;
  /* Used by every page, not just the one that draws the boxes. */
  var lbl = (test.options && test.options.labels) || {};
  var choices = test.mc.choices || 5;
  var h = '<div class="page">';

  /* The registration border.
   *
   * There were five solid black marks on this page: one at each corner and a
   * fifth for orientation. They did their job and they looked like a fault in
   * the printer. On a final examination that has to be signed off before it is
   * sat, a page covered in machine marks does not get signed off.
   *
   * A ruled border does the same work and looks like every form anyone has
   * ever filled in. Its four corners are what the scanner solves the page
   * geometry from, and being a continuous line rather than four separate blobs
   * it cannot half-detect: either the rectangle is there or it is not.
   */
  h += '<div class="edge" style="left:' + L.fid.x0 + 'in;top:' + L.fid.y0 +
       'in;width:' + L.W + 'in;height:' + L.H + 'in"></div>';
  /* A version letter large enough to sort a stack of sheets by eye. */
  if (who.formId) {
    h += absDiv('vmark', L.fid.x1 - 1.02, L.footerY - 0.34, 0.62, 0.46,
      '<span>' + E(who.formId) + '</span>');
  }

  /* header */
  if (first) {
  /* The school's own mark, if the test carries one.
   *
   * A school's answer sheet is a school document. Without this it is a
   * QuickGrade document that happens to be used by a school, which is the
   * wrong way round and is the first thing anyone notices. options.logo is a
   * data URI so the sheet stays a single self-contained file with nothing to
   * fetch, which is the same reason the app has no server.
   *
   * The title moves right to make room, and only when there is a logo, so a
   * test without one lays out exactly as it did. */
  var logo = test.options && test.options.logo;
  var titleX = 0.60;
  if (logo) {
    var logoSize = 0.62;
    h += '<img class="logo" src="' + E(logo) + '" alt="" style="left:' + 0.60 +
         'in;top:' + (L.titleY - 0.14) + 'in;width:' + logoSize + 'in;height:' + logoSize + 'in">';
    titleX = 0.60 + logoSize + 0.14;
  }
  /* The school name above the test title, if the test carries one. A crest
   * on its own says a school was involved; the name says which one, and that
   * is what a person filing the paper afterwards needs. */
  if (test.options && test.options.schoolName) {
    h += absDiv('hdr', titleX, L.titleY - 0.26, L.idLabelX - 0.30 - titleX, 0.18,
      '<span style="font-size:8.6pt;letter-spacing:.09em;text-transform:uppercase">' +
      E(test.options.schoolName) + '</span>', 'overflow:hidden');
  }
  h += absDiv('hdr', titleX, L.titleY, L.idLabelX - 0.30 - titleX, 0.20,
        '<span style="font-size:12pt;font-weight:700">' + E(test.title || 'Test') + '</span>', 'overflow:hidden');
  /* 0.20in, not 0.16: at 7.4pt with a descender the last line of this
   * was being sliced off, which is the sort of thing nobody sees on screen
   * and everybody sees on paper. */
  h += absDiv('hdr', titleX, L.subTitleY, L.idLabelX - 0.30 - titleX, 0.20,
        /* Join only the parts that exist. With no class and no date this used
         * to open with a stray separator floating in front of the text. */
        '<span style="font-size:7.4pt;color:#444">' +
        [test.className, test.date, test.options && test.options.instructions]
          .filter(function (x) { return x; }).map(E).join(' &nbsp;&middot;&nbsp; ') +
        '</span>', 'overflow:hidden');
  }
  h += absDiv('hdr', L.idHeadX, L.idHeadY, 2.40, 0.34,
        '<div style="font-size:7pt;text-align:right;line-height:1.35;color:#222">' +
        E(T('sheet.id')) + ' <b>' + E(who.prefill && who.sid ? digits(who.sid, idDigitsOf(test)).join('')
                     : new Array(idDigitsOf(test) + 1).join('__ ')) + '</b><br>' +
        E(T('sheet.test')) + ' <b>' + E(who.formCode || test.code) + '</b>' +
        (who.formId ? ' &nbsp; ' + E(T('sheet.version')) + ' <b>' + E(who.formId) + '</b>' : '') +
        ' &nbsp; ' + E(T('sheet.pageWord')) + ' <b>' + (pageIdx + 1) + '</b> ' +
        E(T('sheet.of')) + ' <b>' + n + '</b></div>');

  if (first) {
  /* name + class write-in boxes (cropped and stored for every scan) */
  h += absDiv('box', L.nameBox.x, L.nameBox.y, L.nameBox.w, L.nameBox.h, '');
  h += absDiv('boxlbl', L.nameBox.x + 0.07, L.nameBox.y + 0.035, 2.6, 0.13, E(lbl.name || T('sheet.name')));
  h += absDiv('box', L.classBox.x, L.classBox.y, L.classBox.w, L.classBox.h, '');
  h += absDiv('boxlbl', L.classBox.x + 0.07, L.classBox.y + 0.03, 2.6, 0.13, E(lbl.cls || T('sheet.class')));
  if (who.name) {
    h += absDiv('hdr', L.nameBox.x + 0.10, L.nameBox.y + 0.20, L.nameBox.w - 0.2, 0.26,
      '<span style="font-size:13pt;font-weight:700">' + E(who.name) + '</span>', 'overflow:hidden');
  }
  if (who.cls) {
    h += absDiv('hdr', L.classBox.x + 0.10, L.classBox.y + 0.19, L.classBox.w - 0.2, 0.21,
      '<span style="font-size:10pt">' + E(who.cls) + '</span>', 'overflow:hidden');
  }

  }
  /* Filling guide — occupies the gap between the write-in boxes and the grid,
   * so the page reads as designed rather than half-empty. */
  var gy = L.classBox.y + L.classBox.h + 0.20;
  if (first && L.contentTop - gy > 0.72) {
    /* A question printed on the sheet starts above the centre of its row,
     * so the guide has to stop higher than the grid line or it lands on the
     * first question. */
    var guideEnd = questionsOnSheet(test) ? L.rowPitch * 0.45 + 0.06 : 0.16;
    h += absDiv('guide', L.nameBox.x, gy, L.nameBox.w, L.contentTop - gy - guideEnd, '');
    h += absDiv('boxlbl', L.nameBox.x + 0.14, gy + 0.09, 3.2, 0.13, E(lbl.howto || T('sheet.howto')));
    var gx = L.nameBox.x + 0.16, gyy = gy + 0.42;
    var words = (lbl.samples || T('sheet.samples')).split('|');
    var samples = [['fill', words[0] || ''], ['tick', words[1] || ''], ['cross', words[2] || '']];
    samples.forEach(function (s, i) {
      var cx = gx + i * 0.95;
      /* class `gbub`, not `bub`: `bub` means "a bubble the scanner reads", and
       * the self-test asserts that set matches the sampled geometry exactly. */
      h += '<div class="gbub ' + s[0] + '" style="left:' + cx + 'in;top:' + (gyy - L.bubbleR) +
           'in;width:' + (2 * L.bubbleR) + 'in;height:' + (2 * L.bubbleR) + 'in"></div>';
      h += absDiv('lbl', cx + 0.24, gyy - 0.07, 0.72, 0.14,
        '<span style="font-size:6.4pt;color:#555">' + s[1] + '</span>');
    });
    h += absDiv('lbl', L.nameBox.x + 0.16, gy + 0.66, L.nameBox.w - 0.3, 0.14,
      '<span style="font-size:6.4pt;color:#666">' + E(lbl.tips || T('sheet.tips')) + '</span>');
  }

  /* The class-number grid, on the first page only.
   *
   * It used to be on every page, and that was a workflow fault rather than a
   * layout one. A student fills in their number once, on the sheet in front of
   * them at the start. Asking for it again on pages two through five gets it
   * once and blank four times, and every blank one arrives as a scan the
   * teacher has to identify by hand: four per student, a hundred and sixty for
   * a class of forty. A grid nobody fills in is worse than no grid, because it
   * looks like identification and is not.
   *
   * Later pages are attributed by the order they are fed instead. That is a
   * real trade and it is written up where the scanner does it. */
  var nId = idDigitsOf(test);
  var cY = codeY0(nId);
  var sid = digits(who.prefill && who.sid ? who.sid : '', nId);
  if (first || who.prefill) {
  h += absDiv('lbl', L.idLabelX - 0.02, L.idY0 - 0.22, 2.8, 0.16,
      '<b style="font-size:7pt;letter-spacing:.05em">' + E(test.options && test.options.idLabel ||
      lbl.id || (nId <= 3 ? T('sheet.classNumber') : T('sheet.studentId'))) + '</b>');
  for (var r = 0; r < nId; r++) {
    h += absDiv('lbl', L.idLabelX, L.idY0 + r * L.idPitchY - 0.07, 0.55, 0.14, '#' + (r + 1));
    for (var d = 0; d < 10; d++) {
      h += bubble(L.idX0 + d * L.idPitchX, L.idY0 + r * L.idPitchY, String(d),
                  who.prefill && who.sid ? sid[r] === d : false);
    }
  }
  } else {
    /* Later pages say, in words, which student's papers they belong with, so a
     * page separated from its stack is still traceable by a person. The
     * machine has the page number from the strip; this is for the human.
     *
     * The instruction alone states the rule without the reason a teacher
     * would need to follow it under pressure - found by a session that read
     * this label, then read the routing tests, and asked what happens to a
     * page 2 if the page 1s and page 2s get sorted into separate stacks
     * while a class is being collected. The answer is that this page becomes
     * unmatchable to anyone, which is worth saying rather than implying. */
    h += absDiv('lbl', L.idLabelX - 0.02, L.idY0 - 0.22, 2.8, 0.16,
        '<b style="font-size:7pt;letter-spacing:.05em">' +
        E(lbl.continues || T('sheet.continues')) + '</b>');
    h += absDiv('lbl', L.idLabelX - 0.02, L.idY0 - 0.06, 2.8, 0.13,
        '<span style="font-size:6pt;color:#666">' +
        E(lbl.continuesWhy || T('sheet.continuesWhy')) + '</span>');
  }
  /* The code strip: ten small marks, machine only. Printed with the number
   * beside it so a person can still tell two versions apart by eye. */
  var bits = codeToBits(who.formCode || test.code, pageIdx);
  var cY2 = codeY0(nId);
  var mk = 0.085;
  bits.forEach(function (bit, i) {
    if (!bit) return;
    h += '<div class="cmark" style="left:' + (L.idX0 + i * stripPitch() - mk / 2) +
         'in;top:' + (cY2 - mk / 2) + 'in;width:' + mk + 'in;height:' + mk + 'in"></div>';
  });
  /* No code printed beside the strip. The corner already reads "TEST 117 -
   * PAGE 2 OF 5", which tells a person the same thing and tells them the page
   * as well, and the label here sat at a page-1 height that ran into the first
   * question on every later page. */
  /* The page row of ten bubbles is gone. Its number rides on the last four
   * marks of the strip above, and a person reads it from "PAGE n of m" in the
   * corner, which was always there. */

  /* multiple-choice grid */
  var qOnSheetNow = questionsOnSheet(test);
  var qWords = (test.mc && test.mc.text) || [];
  var qOpts = (test.mc && test.mc.options) || [];
  pg.mc.forEach(function (item) {
    /* With the questions on the sheet, the wording sits to the right of the
     * bubbles so a student reads and answers in one place, instead of holding
     * an answer in their head while they hunt for the row on a different
     * piece of paper. The bubbles do not move; only the space around them
     * grew, so the reader sees the geometry it always did. */
    if (qOnSheetNow) {
      var tx = item.x + L.labelW + choices * L.bubblePitch + 0.12;
      var tw = safeRight() - tx;
      var opts = qOpts[item.q] || [];
      var body = '<div class="qstem">' + E(qWords[item.q] || '') + '</div>';
      if (opts.length) {
        body += '<div class="qopts">' + opts.map(function (o, k) {
          return '<span><b>' + E(choiceLabelsOf(test)[k]) + '.</b> ' + E(o) + '</span>';
        }).join('') + '</div>';
      }
      h += absDiv('qtext', tx, item.y - L.rowPitch * 0.42, tw, L.rowPitch * 0.90,
                  body, 'overflow:hidden');
    }
    h += absDiv('qn', item.x, item.y - L.rowPitch / 2, L.labelW - 0.04, L.rowPitch, String(item.q + 1));
    for (var k = 0; k < choices; k++) {
      var cx = item.x + L.labelW + k * L.bubblePitch + L.bubblePitch / 2;
      var keyArr = who.formKey || test.mc.key;
      var filled = who.keyMode && keyArr[item.q] === k;
      h += bubble(cx, item.y, choiceLabelsOf(test)[k], filled);
    }
  });

  /* written-answer boxes */
  pg.written.forEach(function (wb) {
    var wq = (test.written || [])[wb.w] || {};
    /* As wide as its own box, not a fixed 7.2in. The old width reached a
     * quarter of an inch past the page border. */
    h += absDiv('boxlbl', wb.x, wb.labelY, wb.bw, 0.16,
      E((wq.label || ('Question ' + (wb.w + 1)))) +
      '<span style="font-weight:400;color:#666"> &nbsp;(' + (wq.max || 0) + ' pts)</span>');
    h += absDiv('box', wb.x, wb.y, wb.bw, wb.bh, '');
    /* 0.28in is ordinary school ruling. The old 0.32in spacing with a
     * line subtracted left a four-mark answer two lines and half an inch of
     * dead space at the bottom of the box. */
    var lineGap = 0.28;
    var lines = Math.max(0, Math.floor((wb.bh - 0.10) / lineGap));
    for (var li = 1; li <= lines; li++) {
      h += '<div class="writeline" style="left:' + (wb.x + 0.12) + 'in;top:' + (wb.y + li * lineGap) +
           'in;width:' + (wb.bw - 0.24) + 'in"></div>';
    }
  });

  /* footer — kept horizontally between the two bottom corner squares */
  h += absDiv('hdr', L.footerX, L.footerY, L.footerW, 0.14,
    '<div style="font-size:6.4pt;color:#777;display:flex;justify-content:space-between;gap:.2in">' +
    '<span>' + E(T('sheet.footer')) + '</span>' +
    '<span style="overflow:hidden;white-space:nowrap">' + E(who.name || '') + '</span></div>');

  return h + '</div>';
}

/**
 * renderSheets(test, people, opts) -> full HTML document string
 *   people: [{sid, name, cls}] ; pass [{}] for a blank sheet
 *   opts:   { prefill, keyMode, title }
 */
function renderSheets(test, people, opts) {
  opts = opts || {};
  usePaper(test);
  var pages = layoutTest(test);
  var body = '';
  (people && people.length ? people : [{}]).forEach(function (per) {
    for (var i = 0; i < pages.length; i++) {
      body += renderPage(test, pages, i, {
        sid: per.sid, name: per.name, cls: per.cls || test.className,
        prefill: !!opts.prefill && !!per.sid, keyMode: !!opts.keyMode,
        formId: opts.form && !opts.form.primary ? opts.form.id : null,
        formCode: opts.form ? opts.form.code : null,
        formKey: opts.form ? opts.form.key : null
      });
    }
  });
  var count = (people && people.length ? people.length : 1) * pages.length;
  var css = SHEET_CSS.replace(/%PW%/g, L.page.w).replace(/%PH%/g, L.page.h)
                     .replace(/%FONT%/g, global.QG.I18N.fonts().print);
  var I = global.QG.I18N;
  return '<!doctype html><html lang="' + E(I.lang) + '" dir="' + E(I.meta(I.lang).dir) +
    '"><head><meta charset="utf-8"><title>' +
    E(opts.title || T('sheet.docTitle', { title: test.title })) +
    '</title><style>' + css + '</style></head><body>' +
    '<div class="toolbar noprint"><button onclick="window.print()">' +
    E(T('sheet.printBtn', { n: count })) + '</button>' +
    '<span>' + T('sheet.printAdvice', { paper: E((PAPERS[L.paper] || PAPERS.letter).label) }) +
    '</span></div>' +
    body + '</body></html>';
}

global.QG = global.QG || {};
global.QG.Sheet = {
  L: L, LETTERS: LETTERS, laterTop: laterTop, choiceLabelsOf: choiceLabelsOf,
  safeRight: safeRight,
  u: u, v: v, uv: uv, rect: rect,
  idGrid: idGrid, codeBits: codeBits, codeToBits: codeToBits,
  bitsToCode: bitsToCode, bitsToPage: bitsToPage, pageRow: pageRow,
  idDigitsOf: idDigitsOf, ID_DIGIT_CHOICES: ID_DIGIT_CHOICES, codeY0: codeY0, pageY: pageY,
  PAPERS: PAPERS, setPaper: setPaper, paperOf: paperOf, usePaper: usePaper,
  layoutTest: layoutTest, pageIndexFor: pageIndexFor,
  rowsPerCol: rowsPerCol, colsPerPage: colsPerPage, mcPerPage: mcPerPage,
  renderSheets: renderSheets, digits: digits,
  normId: normId, keySid: keySid, isKeySid: isKeySid
};
})(window);
