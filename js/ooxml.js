/* QuickGrade — ooxml.js
 * Hand-rolled ZIP writer + minimal-but-strictly-valid XLSX / DOCX builders.
 * No dependencies, works offline. Files open cleanly in Excel, Word,
 * Google Sheets and Google Docs (uploaded or imported).
 */
(function (global) {
'use strict';

/* ================================================================ ZIP */
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

var TE = new TextEncoder();
function utf8(s) { return TE.encode(s); }

function dosDateTime(d) {
  d = d || new Date();
  var y = d.getFullYear();
  if (y < 1980) y = 1980;
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
    date: (((y - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  };
}

/**
 * Build a ZIP archive using the "stored" (uncompressed) method.
 * entries: [{name:'a/b.xml', data:string|Uint8Array}]
 */
function zip(entries) {
  var dt = dosDateTime(new Date());
  var recs = entries.map(function (e) {
    var name = utf8(e.name);
    var data = (typeof e.data === 'string') ? utf8(e.data) : e.data;
    return { name: name, data: data, crc: crc32(data) };
  });

  var total = 0, cdSize = 0;
  recs.forEach(function (r) {
    r.offset = total;
    total += 30 + r.name.length + r.data.length;
    cdSize += 46 + r.name.length;
  });
  var out = new Uint8Array(total + cdSize + 22);
  var dv = new DataView(out.buffer);
  var p = 0;
  function u32(v) { dv.setUint32(p, v >>> 0, true); p += 4; }
  function u16(v) { dv.setUint16(p, v & 0xFFFF, true); p += 2; }
  function raw(b) { out.set(b, p); p += b.length; }

  recs.forEach(function (r) {
    u32(0x04034b50); u16(20); u16(0x0800); u16(0);     // sig, ver, UTF-8 flag, store
    u16(dt.time); u16(dt.date); u32(r.crc);
    u32(r.data.length); u32(r.data.length);
    u16(r.name.length); u16(0);
    raw(r.name); raw(r.data);
  });

  var cdStart = p;
  recs.forEach(function (r) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0);
    u16(dt.time); u16(dt.date); u32(r.crc);
    u32(r.data.length); u32(r.data.length);
    u16(r.name.length); u16(0); u16(0); u16(0); u16(0);
    u32(0); u32(r.offset);
    raw(r.name);
  });

  /* Snapshot the directory size BEFORE the EOCD writes advance `p`. */
  var cdSizeActual = p - cdStart;
  u32(0x06054b50); u16(0); u16(0);
  u16(recs.length); u16(recs.length);
  u32(cdSizeActual); u32(cdStart); u16(0);
  if (p !== out.length) throw new Error('zip writer size mismatch: ' + p + ' vs ' + out.length);
  return out;
}

/* ================================================================ XML */
/** Escape and strip characters XML 1.0 forbids (pasted rosters carry junk). */
function xml(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
var DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
var RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/* =============================================================== XLSX */
function colName(i) {           // 0 -> A
  var s = '';
  i = i + 1;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function safeSheetName(n, used) {
  var s = String(n || 'Sheet').replace(/[\[\]\*\?\/\\:]/g, '-').slice(0, 31).trim() || 'Sheet';
  var base = s, i = 2;
  while (used.indexOf(s.toLowerCase()) >= 0) { s = (base.slice(0, 28) + '_' + i).slice(0, 31); i++; }
  used.push(s.toLowerCase());
  return s;
}

var XLSX_STYLES = DECL +
'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
'<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="0.##"/></numFmts>' +
'<fonts count="3">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
'</fonts>' +
'<fills count="4">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE9E9"/><bgColor indexed="64"/></patternFill></fill>' +
'</fills>' +
'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
'<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                              /* 0 normal */
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + /* 1 header */
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                      /* 2 percent */
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                      /* 3 number */
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                /* 4 bold   */
  '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +                                /* 5 flagged*/
'</cellXfs>' +
'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
'</styleSheet>';

var XS = { NORMAL: 0, HEADER: 1, PCT: 2, NUM: 3, BOLD: 4, FLAG: 5 };

/**
 * sheets: [{ name, cols:[widths], freezeHeader:true, autoFilter:true,
 *            rows:[ [ cell, ... ] ] }]
 * cell: primitive (string|number|null) or {v, s, t:'n'|'s'}
 */
function buildXlsx(sheets) {
  var used = [];
  sheets = sheets.map(function (s) {
    var c = Object.assign({}, s);
    c.name = safeSheetName(s.name, used);
    return c;
  });

  var parts = [];
  var ctOverrides = '';
  var wbSheets = '', wbRels = '';

  sheets.forEach(function (sh, si) {
    var idx = si + 1;
    var body = '';
    (sh.rows || []).forEach(function (row, ri) {
      var cells = '';
      (row || []).forEach(function (cell, ci) {
        var v = cell, st = 0, forceStr = false;
        if (cell && typeof cell === 'object' && !(cell instanceof Date)) {
          v = cell.v; st = cell.s || 0; forceStr = cell.t === 's';
        }
        if (v == null || v === '') { if (st) cells += '<c r="' + colName(ci) + (ri + 1) + '" s="' + st + '"/>'; return; }
        var ref = colName(ci) + (ri + 1);
        var sAttr = st ? ' s="' + st + '"' : '';
        if (!forceStr && typeof v === 'number' && isFinite(v)) {
          cells += '<c r="' + ref + '"' + sAttr + '><v>' + v + '</v></c>';
        } else {
          cells += '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
        }
      });
      body += '<row r="' + (ri + 1) + '">' + cells + '</row>';
    });

    var nRows = (sh.rows || []).length;
    var nCols = 0;
    (sh.rows || []).forEach(function (r) { if (r && r.length > nCols) nCols = r.length; });

    var cols = '';
    if (sh.cols && sh.cols.length) {
      cols = '<cols>' + sh.cols.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }
    var views = '<sheetViews><sheetView workbookViewId="0"' + (si === 0 ? ' tabSelected="1"' : '') + '>' +
      (sh.freezeHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
                         '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '') +
      '</sheetView></sheetViews>';
    var af = (sh.autoFilter && nRows > 1 && nCols > 0)
      ? '<autoFilter ref="A1:' + colName(nCols - 1) + nRows + '"/>' : '';
    var dim = nRows && nCols ? '<dimension ref="A1:' + colName(nCols - 1) + nRows + '"/>' : '';

    parts.push({
      name: 'xl/worksheets/sheet' + idx + '.xml',
      data: DECL + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        dim + views + '<sheetFormatPr defaultRowHeight="15"/>' + cols +
        '<sheetData>' + body + '</sheetData>' + af + '</worksheet>'
    });
    ctOverrides += '<Override PartName="/xl/worksheets/sheet' + idx + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    wbSheets += '<sheet name="' + xml(sh.name) + '" sheetId="' + idx + '" r:id="rId' + idx + '"/>';
    wbRels += '<Relationship Id="rId' + idx + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + idx + '.xml"/>';
  });

  var styleRid = 'rId' + (sheets.length + 1);
  wbRels += '<Relationship Id="' + styleRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

  var files = [
    { name: '[Content_Types].xml', data: DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      ctOverrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data: DECL + '<Relationships xmlns="' + RELS_NS + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { name: 'xl/workbook.xml', data: DECL +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + wbSheets + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: DECL + '<Relationships xmlns="' + RELS_NS + '">' + wbRels + '</Relationships>' },
    { name: 'xl/styles.xml', data: XLSX_STYLES }
  ].concat(parts);

  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* =============================================================== DOCX */
var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
var TWIP = { letterW: 12240, letterH: 15840, margin: 1000 };
var CONTENT_W = TWIP.letterW - TWIP.margin * 2;   // usable width in twips

function runProps(o) {
  o = o || {};
  var s = '';
  if (o.b) s += '<w:b/>';
  if (o.i) s += '<w:i/>';
  if (o.u) s += '<w:u w:val="single"/>';
  if (o.strike) s += '<w:strike/>';
  if (o.color) s += '<w:color w:val="' + o.color + '"/>';
  if (o.size) s += '<w:sz w:val="' + (o.size * 2) + '"/><w:szCs w:val="' + (o.size * 2) + '"/>';
  if (o.font) s += '<w:rFonts w:ascii="' + xml(o.font) + '" w:hAnsi="' + xml(o.font) + '"/>';
  return s ? '<w:rPr>' + s + '</w:rPr>' : '';
}
function run(text, o) {
  var lines = String(text == null ? '' : text).split(/\r?\n/);
  var body = lines.map(function (t, i) {
    return (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xml(t) + '</w:t>';
  }).join('');
  return '<w:r>' + runProps(o) + body + '</w:r>';
}
/** p(runsOrText, {style, align, spaceBefore, spaceAfter, border, size, b, ...}) */
function p(content, o) {
  o = o || {};
  var pr = '';
  if (o.style) pr += '<w:pStyle w:val="' + o.style + '"/>';
  if (o.align) pr += '<w:jc w:val="' + o.align + '"/>';
  if (o.spaceBefore != null || o.spaceAfter != null)
    pr += '<w:spacing' + (o.spaceBefore != null ? ' w:before="' + o.spaceBefore + '"' : '') +
          (o.spaceAfter != null ? ' w:after="' + o.spaceAfter + '"' : '') + '/>';
  if (o.borderBottom) pr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="' + (o.borderColor || '999999') + '"/></w:pBdr>';
  if (o.borderBox) pr += '<w:pBdr>' +
      '<w:top w:val="single" w:sz="6" w:space="4" w:color="999999"/>' +
      '<w:left w:val="single" w:sz="6" w:space="4" w:color="999999"/>' +
      '<w:bottom w:val="single" w:sz="6" w:space="4" w:color="999999"/>' +
      '<w:right w:val="single" w:sz="6" w:space="4" w:color="999999"/></w:pBdr>';
  if (o.shade) pr += '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>';
  var inner = (typeof content === 'string')
    ? run(content, o)
    : [].concat(content || []).join('');
  return '<w:p>' + (pr ? '<w:pPr>' + pr + '</w:pPr>' : '') + inner + '</w:p>';
}
function pageBreak() { return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }
function emptyP(size) { return '<w:p>' + (size ? '<w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="' + (size * 2) + '"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>' : '') + '</w:p>'; }

/**
 * table(rows, opts)
 *  rows: [ [cell, ...] ] where cell = string | {text, b, align, shade, colspan, size, color}
 *  opts: {widths:[fractions summing ~1], header:true}
 */
function table(rows, opts) {
  opts = opts || {};
  var n = 0;
  rows.forEach(function (r) {
    var c = 0; r.forEach(function (cell) { c += (cell && cell.colspan) || 1; });
    if (c > n) n = c;
  });
  if (!n) return '';
  var fr = opts.widths && opts.widths.length === n
    ? opts.widths
    : Array.apply(null, Array(n)).map(function () { return 1 / n; });
  var sum = fr.reduce(function (a, b) { return a + b; }, 0) || 1;
  var w = fr.map(function (f) { return Math.max(300, Math.round(CONTENT_W * f / sum)); });

  var noBorders = opts.borders === false;
  var borders = '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
      return noBorders
        ? '<w:' + s + ' w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        : '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="B0B7C3"/>';
    }).join('') + '</w:tblBorders>';

  var out = '<w:tbl><w:tblPr>' + (noBorders ? '' : '<w:tblStyle w:val="TableGrid"/>') +
    '<w:tblW w:w="' + CONTENT_W + '" w:type="dxa"/><w:tblLayout w:type="fixed"/>' + borders +
    '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>' +
    '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid>' + w.map(function (x) { return '<w:gridCol w:w="' + x + '"/>'; }).join('') + '</w:tblGrid>';

  rows.forEach(function (row, ri) {
    var isHead = opts.header && ri === 0;
    out += '<w:tr>' + (isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
    var ci = 0;
    row.forEach(function (cell) {
      var c = (typeof cell === 'object' && cell) ? cell : { text: cell };
      var span = c.colspan || 1;
      var cw = 0; for (var k = 0; k < span && ci + k < n; k++) cw += w[ci + k];
      var fill = c.shade || (isHead && !noBorders ? 'E9EEF6' : null);
      var tcPr = '<w:tcPr><w:tcW w:w="' + (cw || w[Math.min(ci, n - 1)]) + '" w:type="dxa"/>' +
        (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') +
        (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : '') +
        '<w:vAlign w:val="center"/></w:tcPr>';
      /* A cell may carry raw paragraph XML (c.xml) — Word requires >= 1 <w:p>. */
      var inner = c.xml || p(String(c.text == null ? '' : c.text), {
        align: c.align, b: c.b || isHead, size: c.size, color: c.color, spaceAfter: 0
      });
      out += '<w:tc>' + tcPr + inner + '</w:tc>';
      ci += span;
    });
    out += '</w:tr>';
  });
  return out + '</w:tbl>' + emptyP();
}

var DOCX_STYLES = DECL +
'<w:styles ' + W_NS + '>' +
'<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/>' +
'</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>' +
  '<w:spacing w:after="80" w:line="252" w:lineRule="auto"/>' +
'</w:pPr></w:pPrDefault></w:docDefaults>' +
'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
  '<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="0" w:after="40"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
'<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
  '<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="60"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="2F5597"/></w:rPr></w:style>' +
'<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
  '<w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
'<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/>' +
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
    return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="B0B7C3"/>';
  }).join('') +
  '</w:tblBorders></w:tblPr></w:style>' +
'</w:styles>';

/** buildDocx(bodyXml) — bodyXml is a concatenation of p()/table()/pageBreak(). */
function buildDocx(bodyXml) {
  var sect = '<w:sectPr><w:pgSz w:w="' + TWIP.letterW + '" w:h="' + TWIP.letterH + '"/>' +
    '<w:pgMar w:top="' + TWIP.margin + '" w:right="' + TWIP.margin + '" w:bottom="' + TWIP.margin +
    '" w:left="' + TWIP.margin + '" w:header="720" w:footer="720" w:gutter="0"/>' +
    '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';

  var doc = DECL + '<w:document ' + W_NS +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' + bodyXml + sect + '</w:body></w:document>';

  var files = [
    { name: '[Content_Types].xml', data: DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data: DECL + '<Relationships xmlns="' + RELS_NS + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: DECL + '<Relationships xmlns="' + RELS_NS + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { name: 'word/styles.xml', data: DOCX_STYLES },
    { name: 'word/document.xml', data: doc }
  ];
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ============================================================ CSV/TSV */
function csvCell(v) {
  var s = String(v == null ? '' : v);
  // Guard against spreadsheet formula injection from pasted names.
  if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
function toTsv(rows) {
  return rows.map(function (r) {
    return r.map(function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]/g, ' '); }).join('\t');
  }).join('\n');
}

global.QG = global.QG || {};
global.QG.OOXML = {
  zip: zip, crc32: crc32, xml: xml,
  buildXlsx: buildXlsx, XS: XS, colName: colName,
  buildDocx: buildDocx, p: p, run: run, table: table, pageBreak: pageBreak, emptyP: emptyP,
  toCsv: toCsv, toTsv: toTsv
};
})(window);
