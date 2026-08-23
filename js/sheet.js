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

var L = {
  page:  { w: 8.5, h: 11 },
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
  idX0: 5.56, idPitchX: 0.235, idDigits: 6,
  idY0: 1.34, idPitchY: 0.196,
  codeY0: 2.58, codeDigits: 3,
  pageY: 3.20, pageMax: 10,

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

function u(x) { return (x - L.fid.x0) / L.W; }
function v(y) { return (y - L.fid.y0) / L.H; }
function uv(x, y) { return { u: u(x), v: v(y) }; }
function rect(x, y, w, h) { return { u0: u(x), v0: v(y), u1: u(x + w), v1: v(y + h) }; }

var LETTERS = 'ABCDEFGHIJ';

function rowsPerCol() {
  return Math.floor((L.contentBottom - L.contentTop) / L.rowPitch) + 1;
}
function colWidth(choices) { return L.labelW + choices * L.rowPitch; }
function colsPerPage(choices) {
  var cw = colWidth(choices) + L.colGap;
  return Math.max(1, Math.floor((L.W + L.colGap) / cw));
}
function mcPerPage(choices) { return rowsPerCol() * colsPerPage(choices); }

/* ---------------------------------------------------- identity blocks */
/** Bubble centres for the 6-digit student ID grid: [row][value] */
function idGrid() {
  var rows = [];
  for (var r = 0; r < L.idDigits; r++) {
    var row = [];
    for (var d = 0; d < 10; d++) row.push(uv(L.idX0 + d * L.idPitchX, L.idY0 + r * L.idPitchY));
    rows.push(row);
  }
  return rows;
}
function codeGrid() {
  var rows = [];
  for (var r = 0; r < L.codeDigits; r++) {
    var row = [];
    for (var d = 0; d < 10; d++) row.push(uv(L.idX0 + d * L.idPitchX, L.codeY0 + r * L.idPitchY));
    rows.push(row);
  }
  return rows;
}
function pageRow() {
  var row = [];
  for (var d = 0; d < L.pageMax; d++) row.push(uv(L.idX0 + d * L.idPitchX, L.pageY));
  return row;
}

/* ------------------------------------------------------ page planning */
/**
 * layoutTest(test) -> array of page descriptors, each:
 *   { pageNo, mc:[{q, choices:[{u,v}]}], written:[{w, rect:{u0,v0,u1,v1}, label, max}] }
 * `q` and `w` are zero-based indexes into test.mc.key / test.written.
 */
function layoutTest(test) {
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
    for (var i = 0; i < take; i++) {
      var c = Math.floor(i / rows), r = i % rows;
      var x0 = L.colLeft + c * (cw + L.colGap);
      var y = L.contentTop + r * L.rowPitch;
      var ch = [];
      for (var k = 0; k < choices; k++) {
        ch.push(uv(x0 + L.labelW + k * L.rowPitch + L.rowPitch / 2, y));
      }
      mc.push({ q: q + i, row: r, col: c, x: x0, y: y, choices: ch });
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
function digits(nStr, count) {
  var s = String(nStr == null ? '' : nStr).replace(/\D/g, '');
  while (s.length < count) s = '0' + s;
  return s.slice(-count).split('').map(Number);
}
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
'@page{size:8.5in 11in;margin:0}',
'*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
'html,body{margin:0;padding:0;background:#8a8f99;font-family:Arial,Helvetica,sans-serif;color:#000}',
'.page{position:relative;width:8.5in;height:11in;background:#fff;overflow:hidden;',
'  margin:14px auto;box-shadow:0 4px 18px rgba(0,0,0,.35)}',
'@media print{body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}',
'  .page:last-child{page-break-after:auto}.noprint{display:none!important}}',
'.fid{position:absolute;background:#000}',
'.bub{position:absolute;border:1.1px solid #1a1a1a;border-radius:50%;font-size:5.6pt;line-height:1;',
'  color:#b9b9b9;text-align:center;display:flex;align-items:center;justify-content:center;background:#fff}',
'.bub.fill{background:#000;border-color:#000}',
'.lbl{position:absolute;font-size:6.6pt;color:#333;display:flex;align-items:center}',
'.qn{position:absolute;font-size:7.4pt;color:#111;display:flex;align-items:center;justify-content:flex-end;',
'  padding-right:.05in;font-weight:600}',
'.box{position:absolute;border:1.1px solid #444;border-radius:.06in;background:#fff}',
'.boxlbl{position:absolute;font-size:7.6pt;color:#333;font-weight:700;letter-spacing:.04em}',
'.hdr{position:absolute;font-family:Arial;color:#000}',
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
        'ID <b>' + E(who.prefill && who.sid ? who.sid : '__ __ __ __ __ __') + '</b><br>' +
        'TEST <b>' + E(test.code) + '</b> &nbsp; PAGE <b>' + (pageIdx + 1) + ' of ' + n + '</b></div>');

  /* name + class write-in boxes (cropped and stored for every scan) */
  h += absDiv('box', L.nameBox.x, L.nameBox.y, L.nameBox.w, L.nameBox.h, '');
  h += absDiv('boxlbl', L.nameBox.x + 0.06, L.nameBox.y + 0.04, 2, 0.14, 'NAME');
  h += absDiv('boxlbl', L.classBox.x + 0.06, L.classBox.y + 0.03, 2.6, 0.14, 'CLASS / PERIOD');
  h += absDiv('box', L.classBox.x, L.classBox.y, L.classBox.w, L.classBox.h, '');
  if (who.name) {
    h += absDiv('hdr', L.nameBox.x + 0.10, L.nameBox.y + 0.17, L.nameBox.w - 0.2, 0.26,
      '<span style="font-size:13pt;font-weight:700">' + E(who.name) + '</span>', 'overflow:hidden');
  }
  if (who.cls) {
    h += absDiv('hdr', L.classBox.x + 0.10, L.classBox.y + 0.15, L.classBox.w - 0.2, 0.22,
      '<span style="font-size:10pt">' + E(who.cls) + '</span>', 'overflow:hidden');
  }

  /* identity bubble grids */
  var sid = digits(who.prefill && who.sid ? who.sid : '', L.idDigits);
  var idg = idGrid();
  h += absDiv('lbl', L.idLabelX - 0.02, L.idY0 - 0.22, 2.8, 0.16,
      '<b style="font-size:7pt;letter-spacing:.05em">STUDENT ID</b>');
  for (var r = 0; r < L.idDigits; r++) {
    h += absDiv('lbl', L.idLabelX, L.idY0 + r * L.idPitchY - 0.07, 0.55, 0.14, '#' + (r + 1));
    for (var d = 0; d < 10; d++) {
      h += bubble(L.idX0 + d * L.idPitchX, L.idY0 + r * L.idPitchY, String(d),
                  who.prefill && who.sid ? sid[r] === d : false);
    }
  }
  var code = digits(test.code, L.codeDigits);
  h += absDiv('lbl', L.idLabelX - 0.02, L.codeY0 - 0.20, 2.8, 0.14,
      '<b style="font-size:6.6pt;letter-spacing:.05em">TEST CODE (pre-filled)</b>');
  for (var r2 = 0; r2 < L.codeDigits; r2++) {
    h += absDiv('lbl', L.idLabelX, L.codeY0 + r2 * L.idPitchY - 0.07, 0.55, 0.14, '#' + (r2 + 1));
    for (var d2 = 0; d2 < 10; d2++) {
      h += bubble(L.idX0 + d2 * L.idPitchX, L.codeY0 + r2 * L.idPitchY, String(d2), code[r2] === d2);
    }
  }
  h += absDiv('lbl', L.idLabelX, L.pageY - 0.07, 0.55, 0.14, 'PAGE');
  for (var d3 = 0; d3 < L.pageMax; d3++) {
    h += bubble(L.idX0 + d3 * L.idPitchX, L.pageY, String(d3 + 1), d3 === pageIdx);
  }

  /* multiple-choice grid */
  pg.mc.forEach(function (item) {
    h += absDiv('qn', item.x, item.y - L.rowPitch / 2, L.labelW - 0.04, L.rowPitch, String(item.q + 1));
    for (var k = 0; k < choices; k++) {
      var cx = item.x + L.labelW + k * L.rowPitch + L.rowPitch / 2;
      var filled = who.keyMode && test.mc.key[item.q] === k;
      h += bubble(cx, item.y, LETTERS[k], filled);
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
    '<span>QuickGrade answer sheet &middot; print at 100% &middot; keep the four corner squares clean</span>' +
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
  var pages = layoutTest(test);
  var body = '';
  (people && people.length ? people : [{}]).forEach(function (per) {
    for (var i = 0; i < pages.length; i++) {
      body += renderPage(test, pages, i, {
        sid: per.sid, name: per.name, cls: per.cls || test.className,
        prefill: !!opts.prefill && !!per.sid, keyMode: !!opts.keyMode
      });
    }
  });
  var count = (people && people.length ? people.length : 1) * pages.length;
  return '<!doctype html><html><head><meta charset="utf-8"><title>' +
    E(opts.title || (test.title + ' — answer sheets')) + '</title><style>' + SHEET_CSS + '</style></head><body>' +
    '<div class="toolbar noprint"><button onclick="window.print()">Print ' + count + ' page' +
    (count === 1 ? '' : 's') + '</button>' +
    '<span>Set scale to <b>100% / Actual size</b> and margins to <b>None</b>. ' +
    'Do not enable &ldquo;fit to page&rdquo; if it adds borders.</span></div>' +
    body + '</body></html>';
}

global.QG = global.QG || {};
global.QG.Sheet = {
  L: L, LETTERS: LETTERS, u: u, v: v, uv: uv, rect: rect,
  idGrid: idGrid, codeGrid: codeGrid, pageRow: pageRow,
  layoutTest: layoutTest, pageIndexFor: pageIndexFor,
  rowsPerCol: rowsPerCol, colsPerPage: colsPerPage, mcPerPage: mcPerPage,
  renderSheets: renderSheets, digits: digits
};
})(window);
