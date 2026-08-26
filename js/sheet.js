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
var MARGIN = 0.55;              // fiducial centre inset from the paper edge

var L = {
  page:  { w: 8.5, h: 11 },
  paper: 'letter',
  fid:   { x0: 0.55, y0: 0.55, x1: 7.95, y1: 10.45, size: 0.30 },
  keystone: { x: 1.20, y: 0.55, size: 0.22 },   // orientation mark: top-left only

  /* Nothing may be printed within QUIET inches of a fiducial's bounding box —
   * ink that touches a corner square merges with it under threshold and the
   * sheet stops being detectable. Every constant below respects that. */
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

  contentTop: 3.48, contentBottom: 10.02,
  rowPitch: 0.255,
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
  L.footerY   = L.fid.y1 - 0.13;
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
function usePaper(test) { return setPaper(paperOf(test)); }

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
function colWidth(choices) { return L.labelW + choices * L.rowPitch; }
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
function pageY(n) { return codeY0(n) + (L.codeDigits - 1) * L.idPitchY + L.pageGap; }

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
function codeGrid(n) {
  n = n || L.idDigits;
  var y0 = codeY0(n), rows = [];
  for (var r = 0; r < L.codeDigits; r++) {
    var row = [];
    for (var d = 0; d < 10; d++) row.push(uv(L.idX0 + d * L.idPitchX, y0 + r * L.idPitchY));
    rows.push(row);
  }
  return rows;
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
  var perPage = mcPerPage(choices);
  var rows = rowsPerCol(), cols = colsPerPage(choices);
  var cw = colWidth(choices);
  var pages = [];
  var q = 0;

  while (q < nMc) {
    var mc = [];
    var take = Math.min(perPage, nMc - q);
    /* Spread the questions evenly rather than filling column 1 to the brim and
     * leaving a four-question stub in column 2. */
    var colsUsed = Math.max(1, Math.min(cols, Math.ceil(take / rows)));
    var rowsUsed = Math.ceil(take / colsUsed);
    for (var i = 0; i < take; i++) {
      var c = Math.floor(i / rowsUsed), r = i % rowsUsed;
      var x0 = L.colLeft + c * (cw + L.colGap);
      var y = L.contentTop + r * L.rowPitch;
      var ch = [];
      for (var k = 0; k < choices; k++) {
        ch.push(uv(x0 + L.labelW + k * L.rowPitch + L.rowPitch / 2, y));
      }
      mc.push({
        q: q + i, row: r, col: c, x: x0, y: y, choices: ch,
        /* the strip of paper this question occupies — cropped and shown to the
         * teacher whenever the read was not clean */
        rect: rect(x0, y - L.rowPitch * 0.62, cw, L.rowPitch * 1.24)
      });
    }
    pages.push({ pageNo: pages.length + 1, mc: mc, written: [] });
    q += take;
  }

  var per = Math.max(1, Math.min(6, test.options && test.options.wPerPage || 2));
  for (var wi = 0; wi < written.length; wi += per) {
    var group = written.slice(wi, wi + per);
    var n = group.length;
    var avail = L.contentBottom - L.contentTop - (n - 1) * L.wGap;
    var each = avail / n;
    var list = [];
    for (var j = 0; j < n; j++) {
      var top = L.contentTop + j * (each + L.wGap);
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
'.fid{position:absolute;background:#000}',
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
'.writeline{position:absolute;border-top:.6px dotted #c8c8c8}',
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
  var choices = test.mc.choices || 5;
  var h = '<div class="page">';

  /* fiducials */
  var s = L.fid.size, hs = s / 2;
  [[L.fid.x0, L.fid.y0], [L.fid.x1, L.fid.y0], [L.fid.x0, L.fid.y1], [L.fid.x1, L.fid.y1]]
    .forEach(function (c) {
      h += '<div class="fid" style="left:' + (c[0] - hs) + 'in;top:' + (c[1] - hs) +
           'in;width:' + s + 'in;height:' + s + 'in"></div>';
    });
  h += '<div class="fid" style="left:' + (L.keystone.x - L.keystone.size / 2) + 'in;top:' +
       (L.keystone.y - L.keystone.size / 2) + 'in;width:' + L.keystone.size + 'in;height:' +
       L.keystone.size + 'in"></div>';

  /* A version letter large enough to sort a stack of sheets by eye. */
  if (who.formId) {
    h += absDiv('vmark', L.fid.x1 - 1.02, L.footerY - 0.34, 0.62, 0.46,
      '<span>' + E(who.formId) + '</span>');
  }

  /* header */
  h += absDiv('hdr', 0.60, L.titleY, 4.20, 0.20,
        '<span style="font-size:12pt;font-weight:700">' + E(test.title || 'Test') + '</span>', 'overflow:hidden');
  h += absDiv('hdr', 0.60, L.subTitleY, 4.20, 0.16,
        '<span style="font-size:7.4pt;color:#444">' + E(test.className || '') +
        (test.date ? ' &nbsp;&middot;&nbsp; ' + E(test.date) : '') +
        (test.options && test.options.instructions ? ' &nbsp;&middot;&nbsp; ' + E(test.options.instructions) : '') +
        '</span>', 'overflow:hidden');
  h += absDiv('hdr', L.idHeadX, L.idHeadY, 2.40, 0.34,
        '<div style="font-size:7pt;text-align:right;line-height:1.35;color:#222">' +
        E(T('sheet.id')) + ' <b>' + E(who.prefill && who.sid ? digits(who.sid, idDigitsOf(test)).join('')
                     : new Array(idDigitsOf(test) + 1).join('__ ')) + '</b><br>' +
        E(T('sheet.test')) + ' <b>' + E(who.formCode || test.code) + '</b>' +
        (who.formId ? ' &nbsp; ' + E(T('sheet.version')) + ' <b>' + E(who.formId) + '</b>' : '') +
        ' &nbsp; ' + E(T('sheet.pageWord')) + ' <b>' + (pageIdx + 1) + '</b> ' +
        E(T('sheet.of')) + ' <b>' + n + '</b></div>');

  /* name + class write-in boxes (cropped and stored for every scan) */
  h += absDiv('box', L.nameBox.x, L.nameBox.y, L.nameBox.w, L.nameBox.h, '');
  var lbl = (test.options && test.options.labels) || {};
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

  /* Filling guide — occupies the gap between the write-in boxes and the grid,
   * so the page reads as designed rather than half-empty. */
  var gy = L.classBox.y + L.classBox.h + 0.20;
  if (L.contentTop - gy > 0.72) {
    h += absDiv('guide', L.nameBox.x, gy, L.nameBox.w, L.contentTop - gy - 0.16, '');
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

  /* identity bubble grids */
  var nId = idDigitsOf(test);
  var cY = codeY0(nId), pY = pageY(nId);
  var sid = digits(who.prefill && who.sid ? who.sid : '', nId);
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
  var code = digits(who.formCode || test.code, L.codeDigits);
  h += absDiv('lbl', L.idLabelX - 0.02, cY - 0.20, 2.8, 0.14,
      '<b style="font-size:6.6pt;letter-spacing:.05em">' + E(lbl.code || T('sheet.testCode')) + '</b>');
  for (var r2 = 0; r2 < L.codeDigits; r2++) {
    h += absDiv('lbl', L.idLabelX, cY + r2 * L.idPitchY - 0.07, 0.55, 0.14, '#' + (r2 + 1));
    for (var d2 = 0; d2 < 10; d2++) {
      h += bubble(L.idX0 + d2 * L.idPitchX, cY + r2 * L.idPitchY, String(d2), code[r2] === d2);
    }
  }
  h += absDiv('lbl', L.idLabelX, pY - 0.07, 0.62, 0.14, E(lbl.page || T('sheet.pageWord')));
  for (var d3 = 0; d3 < L.pageMax; d3++) {
    h += bubble(L.idX0 + d3 * L.idPitchX, pY, String(d3 + 1), d3 === pageIdx);
  }

  /* multiple-choice grid */
  pg.mc.forEach(function (item) {
    h += absDiv('qn', item.x, item.y - L.rowPitch / 2, L.labelW - 0.04, L.rowPitch, String(item.q + 1));
    for (var k = 0; k < choices; k++) {
      var cx = item.x + L.labelW + k * L.rowPitch + L.rowPitch / 2;
      var keyArr = who.formKey || test.mc.key;
      var filled = who.keyMode && keyArr[item.q] === k;
      h += bubble(cx, item.y, choiceLabelsOf(test)[k], filled);
    }
  });

  /* written-answer boxes */
  pg.written.forEach(function (wb) {
    var wq = (test.written || [])[wb.w] || {};
    h += absDiv('boxlbl', wb.x, wb.labelY, 7.2, 0.16,
      E((wq.label || ('Question ' + (wb.w + 1)))) +
      '<span style="font-weight:400;color:#666"> &nbsp;(' + (wq.max || 0) + ' pts)</span>');
    h += absDiv('box', wb.x, wb.y, wb.bw, wb.bh, '');
    var lines = Math.max(0, Math.floor(wb.bh / 0.32) - 1);
    for (var li = 1; li <= lines; li++) {
      h += '<div class="writeline" style="left:' + (wb.x + 0.12) + 'in;top:' + (wb.y + li * 0.32) +
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
  L: L, LETTERS: LETTERS, choiceLabelsOf: choiceLabelsOf,
  u: u, v: v, uv: uv, rect: rect,
  idGrid: idGrid, codeGrid: codeGrid, pageRow: pageRow,
  idDigitsOf: idDigitsOf, ID_DIGIT_CHOICES: ID_DIGIT_CHOICES, codeY0: codeY0, pageY: pageY,
  PAPERS: PAPERS, setPaper: setPaper, paperOf: paperOf, usePaper: usePaper,
  layoutTest: layoutTest, pageIndexFor: pageIndexFor,
  rowsPerCol: rowsPerCol, colsPerPage: colsPerPage, mcPerPage: mcPerPage,
  renderSheets: renderSheets, digits: digits,
  normId: normId, keySid: keySid, isKeySid: isKeySid
};
})(window);
