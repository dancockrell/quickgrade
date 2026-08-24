/* QuickGrade — parse.js
 *
 * Teachers already have their answer key written down somewhere: a numbered
 * list, a run of letters, a column pasted out of a spreadsheet, a Word doc
 * with the questions in it. Making them retype it into our format is our
 * problem to solve, not theirs.
 *
 * Everything here is a best guess that is always shown back for confirmation
 * before it is applied. It never silently overwrites a key.
 */
(function (global) {
'use strict';

var LETTERS = 'ABCDEFGHIJ';
/* English is always understood, whatever the interface language: a teacher
 * may well be pasting a key that came from an English source. The pack adds
 * its own words on top rather than replacing these. */
var TF_EN = { T: 0, TRUE: 0, F: 1, FALSE: 1, Y: 0, YES: 0, N: 1, NO: 1 };
var POINT_WORDS_EN = ['pts', 'pt', 'points', 'point', 'marks', 'mark'];

function packList(key) {
  var v;
  try { v = global.QG.T(key); } catch (e) { return []; }
  if (!v || v === key) return [];
  return v.split(/[,|]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

/* Rebuilt when the language changes, not on every line of a pasted key. */
var _tf = null, _tfLang = null;
function tfMap() {
  var lang = null;
  try { lang = global.QG.I18N.lang; } catch (e) {}
  if (_tf && _tfLang === lang) return _tf;
  _tfLang = lang;
  var m = {}, k;
  for (k in TF_EN) m[k] = TF_EN[k];
  packList('parse.trueWords').forEach(function (w) { m[w.toUpperCase()] = 0; });
  packList('parse.falseWords').forEach(function (w) { m[w.toUpperCase()] = 1; });
  _tf = m;
  return m;
}

function pointWords() {
  return POINT_WORDS_EN.concat(packList('parse.pointWords'));
}

/* Longest first, so "points" is not eaten by "pt". */
function pointWordPattern() {
  var ws = pointWords().slice().sort(function (a, b) { return b.length - a.length; })
    .map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  return '(?:' + ws.join('|') + ')';
}

function norm(text) {
  return String(text || '')
    .replace(/ /g, ' ')                 // nbsp out of Word/Docs
    .replace(/[‐-―]/g, '-')        // fancy dashes
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

/**
 * parseAnswerKey(text) -> {
 *   answers: [choiceIndex|null],  // dense, index 0 = question 1
 *   count, maxChoice, mode, warnings[], sample[]
 * }
 */
function parseAnswerKey(text) {
  var raw = norm(text).trim();
  var warnings = [];
  if (!raw) return { answers: [], count: 0, maxChoice: 0, mode: 'empty', warnings: ['Nothing pasted.'] };

  /* ---------- 1. true/false or yes/no ---------- */
  var tokens = raw.split(/[\s,;|]+/).filter(Boolean);
  var tfTokens = tokens.filter(function (t) {
    return tfMap()[t.replace(/^\d+\s*[.):\-]?/, '').toUpperCase()] != null;
  });
  var numberedTF = tokens.length && tfTokens.length >= tokens.length * 0.8;
  if (numberedTF && tokens.length > 1) {
    var tfAns = tokens.map(function (t) {
      var v = t.replace(/^\d+\s*[.):\-]?/, '').toUpperCase();
      return tfMap()[v] != null ? tfMap()[v] : null;
    });
    return finish(tfAns, 'true/false', warnings, 2);
  }

  /* ---------- 2. one question per line ----------
   * A numbered true/false key ("1. T") is rewritten to "1. A" / "1. B" first,
   * so the ordinary line parser handles it without a second code path. */
  var forcedTF = false;
  /* Built from the vocabulary rather than hard-coded, so a Korean "1. O"
   * or a Thai "1. ถูก" is recognised as a true/false key. */
  var tfWords = Object.keys(tfMap()).sort(function (a, b) { return b.length - a.length; })
    .map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  var tfLine = new RegExp('^(\\s*\\d{1,3}\\s*[.):\\-\\t=,;]+\\s*)(' +
    tfWords.join('|') + ')\\s*$', 'i');
  var tfCount = 0;
  var rewritten = norm(raw).split(/\r?\n/).map(function (line) {
    var m = line.match(tfLine);
    if (!m) return line;
    tfCount++;
    return m[1] + (tfMap()[m[2].toUpperCase()] === 0 ? 'A' : 'B');
  });
  if (tfCount >= 2) { raw = rewritten.join('\n'); forcedTF = true; }

  var byNum = {}, lineHits = 0, maxNum = 0, dupes = 0;
  norm(raw).split(/\r?\n/).forEach(function (line) {
    var s = line.trim();
    if (!s) return;
    var m =
      /* "12. B"  "12) b"  "12 - B"  "12<tab>B"  "12: B" */
      s.match(/^(\d{1,3})\s*[.):\-\t=]+\s*([A-Ja-j])(?![A-Za-z])/) ||
      /* "12,B" from a spreadsheet */
      s.match(/^(\d{1,3})\s*[,;]\s*([A-Ja-j])\s*$/) ||
      /* "12. What is the powerhouse of the cell?   B"  — answer last */
      s.match(/^(\d{1,3})\s*[.):\-\t]?\s+.*?([A-Ja-j])\s*$/) ||
      /* bare "12 B" */
      s.match(/^(\d{1,3})\s+([A-Ja-j])\s*$/);
    if (!m) return;
    var n = parseInt(m[1], 10);
    if (!n || n > 999) return;
    if (byNum[n] != null) dupes++;
    byNum[n] = LETTERS.indexOf(m[2].toUpperCase());
    if (n > maxNum) maxNum = n;
    lineHits++;
  });

  if (lineHits >= 2) {
    if (dupes) warnings.push(dupes + ' question number(s) appeared more than once — the last one won.');
    var missing = [];
    var dense = [];
    for (var i = 1; i <= maxNum; i++) {
      dense.push(byNum[i] == null ? null : byNum[i]);
      if (byNum[i] == null) missing.push(i);
    }
    if (missing.length) {
      warnings.push('No answer found for question' + (missing.length === 1 ? ' ' : 's ') +
        missing.slice(0, 12).join(', ') + (missing.length > 12 ? '…' : '') +
        '. Those are left blank.');
    }
    return finish(dense, forcedTF ? 'true/false' : 'numbered list', warnings,
                  forcedTF ? 2 : 0);
  }

  /* ---------- 3. a plain run of letters ----------
   * Only when nothing outside A-J appears, so prose can never be mistaken
   * for a key. "BCADE BCADE" and "B C A D E" both land here. */
  if (!/[K-Zk-z]/.test(raw)) {
    var seq = [];
    raw.replace(/[A-Ja-j]/g, function (ch) { seq.push(LETTERS.indexOf(ch.toUpperCase())); return ch; });
    if (seq.length >= 2) {
      warnings.push('Read as a straight run of ' + seq.length +
        ' answers, in order, starting at question 1.');
      return finish(seq, 'letter run', warnings);
    }
  }

  /* ---------- 4. a single column of letters, one per line ---------- */
  var colOnly = norm(raw).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (colOnly.length >= 2 && colOnly.every(function (l) { return /^[A-Ja-j]$/.test(l); })) {
    warnings.push('Read as one answer per line, starting at question 1.');
    return finish(colOnly.map(function (l) { return LETTERS.indexOf(l.toUpperCase()); }),
      'one per line', warnings);
  }

  return { answers: [], count: 0, maxChoice: 0, mode: 'unrecognised',
    warnings: ['Could not find an answer key in that. Try one per line, like "1. B", ' +
               'or a run of letters like "B C A D E".'] };
}

function finish(answers, mode, warnings, forceChoices) {
  var maxChoice = forceChoices || 0;
  answers.forEach(function (a) { if (a != null && a + 1 > maxChoice) maxChoice = a + 1; });
  var filled = answers.filter(function (a) { return a != null; }).length;
  return {
    answers: answers, count: answers.length, filled: filled,
    maxChoice: Math.max(2, maxChoice), mode: mode, warnings: warnings || []
  };
}

/**
 * parseWritten(text) -> [{label, max}]
 * Accepts "Explain osmosis (5 points)", "Explain osmosis - 5",
 * "3. Explain osmosis<tab>5", or a bare line (defaults to 5 points).
 */
function parseWritten(text, defaultMax) {
  var out = [];
  norm(text).split(/\r?\n/).forEach(function (line) {
    var s = line.trim();
    if (!s) return;
    s = s.replace(/^\d{1,3}\s*[.):\-]\s*/, '');          // drop a leading number
    var max = null;
    var PW = pointWordPattern();
    var m = s.match(new RegExp('[\\(\\[]\\s*(\\d+(?:\\.\\d+)?)\\s*' + PW + '?\\s*[\\)\\]]\\s*$', 'i')) ||
            s.match(new RegExp('[\\-–—,;\\t]\\s*(\\d+(?:\\.\\d+)?)\\s*' + PW + '\\s*$', 'i')) ||
            s.match(new RegExp('\\s(\\d+(?:\\.\\d+)?)\\s*' + PW + '\\s*$', 'i')) ||
            s.match(/\t\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) { max = parseFloat(m[1]); s = s.slice(0, m.index).trim().replace(/[\-–—,;:]\s*$/, ''); }
    if (!s) return;
    out.push({ label: s, max: max == null ? (defaultMax || 5) : max, kind: 'short', expected: '' });
  });
  return out;
}

/* ---------------------------------------------------------- standards ----
 * Which objective each question tests. Teachers write this down in several
 * shapes and none of them should have to be retyped:
 *
 *   1. Cells            Cells: 1-5, 9        1-10  Cells        Cells
 *   2. Cells            Transport: 6-8       11-20 Transport    Cells
 *   3. Transport                                                Transport
 */
function expandRanges(spec) {
  var out = [];
  String(spec).split(/\s*,\s*/).forEach(function (part) {
    var m = part.match(/^\s*(\d{1,3})\s*(?:-\s*(\d{1,3}))?\s*$/);
    if (!m) return;
    var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    if (b < a) { var t = a; a = b; b = t; }
    for (var i = a; i <= b && i - a < 500; i++) out.push(i);
  });
  return out;
}

/**
 * parseTopics(text, count) -> { topics:[], assigned, warnings[] }
 * `topics` is dense and `count` long; unassigned questions stay ''.
 */
function parseTopics(text, count) {
  var topics = [], warnings = [], assigned = 0;
  for (var i = 0; i < count; i++) topics.push('');
  var lines = norm(text).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) return { topics: topics, assigned: 0, mode: 'empty', warnings: ['Nothing pasted.'] };

  var NUMS = '\\d{1,3}(?:\\s*-\\s*\\d{1,3})?(?:\\s*,\\s*\\d{1,3}(?:\\s*-\\s*\\d{1,3})?)*';
  var numsThenName = new RegExp('^(' + NUMS + ')\\s*[:.)\\-]?\\s+(.+)$');
  var nameThenNums = new RegExp('^(.+?)\\s*[:=]\\s*(' + NUMS + ')\\s*$');

  var used = 0;
  lines.forEach(function (line) {
    var m = line.match(numsThenName);
    var nums = null, name = null;
    if (m) { nums = m[1]; name = m[2]; }
    else {
      m = line.match(nameThenNums);
      if (m) { name = m[1]; nums = m[2]; }
    }
    if (!nums) return;
    used++;
    expandRanges(nums).forEach(function (q) {
      if (q >= 1 && q <= count) { topics[q - 1] = name.trim(); assigned++; }
    });
  });

  if (used) {
    var gaps = topics.filter(function (t) { return !t; }).length;
    if (gaps) warnings.push(gaps + ' question(s) have no objective yet.');
    return { topics: topics, assigned: assigned, mode: 'numbered', warnings: warnings };
  }

  /* No numbers anywhere: treat the lines as one objective per question. */
  if (lines.length > count) {
    warnings.push('There are ' + lines.length + ' lines but only ' + count +
      ' questions — the extra lines were ignored.');
  } else if (lines.length < count) {
    warnings.push('There are only ' + lines.length + ' lines for ' + count +
      ' questions — the rest were left blank.');
  }
  for (var j = 0; j < Math.min(count, lines.length); j++) { topics[j] = lines[j]; assigned++; }
  return { topics: topics, assigned: assigned, mode: 'one per line', warnings: warnings };
}

/**
 * parseQuestionText(text) -> { 1: 'question text', ... }
 * Pulled from a pasted test so the graded top sheet can show what was asked.
 */
function parseQuestionText(text) {
  var out = {};
  norm(text).split(/\r?\n/).forEach(function (line) {
    var m = line.trim().match(/^(\d{1,3})\s*[.):\-]\s*(.+)$/);
    if (!m) return;
    var body = m[2].trim()
      .replace(/\s+[A-Ja-j]\s*$/, '')                    // a trailing answer letter
      .replace(/^[A-Ja-j][.):]\s*/, '');                 // a leading option marker
    if (body.length > 1) out[parseInt(m[1], 10)] = body;
  });
  return out;
}

global.QG = global.QG || {};
global.QG.Parse = {
  parseAnswerKey: parseAnswerKey,
  parseWritten: parseWritten,
  parseQuestionText: parseQuestionText,
  parseTopics: parseTopics,
  expandRanges: expandRanges,
  LETTERS: LETTERS
};
})(window);
