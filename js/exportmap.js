/* QuickGrade — exportmap.js
 *
 * Gradebooks disagree about everything: column names, order, whether percent
 * is 0-100 or 0-1, whether the key is an email or a district id. Rather than
 * hardcode one vendor's layout, a format is DATA — an ordered list of fields,
 * each with a header you can rename. Ship a few starting points, let the
 * teacher bend them, save the result.
 *
 * Nothing here knows about any particular vendor's API. A format produces rows;
 * a destination (file, clipboard, endpoint) decides where the rows go.
 */
(function (global) {
'use strict';
var Q = global.QG;
/* Resolved on use, not at load: this file must not care whether it is
 * evaluated before or after sheet.js. */
function S() { return global.QG.Sheet; }

function nameParts(full) {
  var t = String(full || '').trim().split(/\s+/);
  if (t.length < 2) return { first: full || '', last: '' };
  return { first: t.slice(0, -1).join(' '), last: t[t.length - 1] };
}

/* ---- the fields a row can expose -------------------------------------- */
var FIELDS = [
  { key: 'name',      label: 'Student name',      head: 'Student',    g: 'Who' },
  { key: 'last',      label: 'Last name',         head: 'Last Name',  g: 'Who' },
  { key: 'first',     label: 'First name',        head: 'First Name', g: 'Who' },
  { key: 'sortname',  label: 'Last, First',       head: 'Student',    g: 'Who' },
  { key: 'sid',       label: 'Student ID',        head: 'ID',         g: 'Who' },
  { key: 'email',     label: 'Email',             head: 'Email',      g: 'Who' },
  { key: 'class',     label: 'Class / period',    head: 'Section',    g: 'Who' },

  { key: 'testTitle', label: 'Test title',        head: 'Assignment', g: 'Test' },
  { key: 'testCode',  label: 'Test code',         head: 'Test Code',  g: 'Test' },
  { key: 'date',      label: 'Date',              head: 'Date',       g: 'Test' },

  { key: 'total',     label: 'Points earned',     head: 'Points',     g: 'Score' },
  { key: 'possible',  label: 'Points possible',   head: 'Out Of',     g: 'Score' },
  { key: 'pct100',    label: 'Percent (0-100)',   head: 'Percent',    g: 'Score' },
  { key: 'pct01',     label: 'Percent (0-1)',     head: 'Percent',    g: 'Score' },
  { key: 'letter',    label: 'Letter grade',      head: 'Grade',      g: 'Score' },
  { key: 'mcCorrect', label: 'MC correct',        head: 'MC Correct', g: 'Score' },
  { key: 'mcCount',   label: 'MC question count', head: 'MC Total',   g: 'Score' },
  { key: 'mcPoints',  label: 'MC points',         head: 'MC Points',  g: 'Score' },
  { key: 'wPoints',   label: 'Written points',    head: 'Written',    g: 'Score' },
  { key: 'wPossible', label: 'Written possible',  head: 'Written Out Of', g: 'Score' },

  { key: 'pages',     label: 'Pages scanned',     head: 'Pages',      g: 'Status' },
  { key: 'issues',    label: 'Issues',            head: 'Issues',     g: 'Status' },
  { key: 'scanned',   label: 'Scanned? yes/no',   head: 'Scanned',    g: 'Status' },
  { key: 'blank',     label: 'Blank answers',     head: 'Blank',      g: 'Status' },
  { key: 'multi',     label: 'Double-marked',     head: 'Double Marked', g: 'Status' },

  /* expanders — one field, many columns */
  { key: 'mc:all',    label: 'Every MC answer (Q1…Qn)',  g: 'Detail', expand: 'mc' },
  { key: 'mc:right',  label: 'Every MC right/wrong',     g: 'Detail', expand: 'mcRight' },
  { key: 'written:all', label: 'Every written score',    g: 'Detail', expand: 'written' }
];
var FIELD_BY_KEY = {};
FIELDS.forEach(function (f) { FIELD_BY_KEY[f.key] = f; });

/* ---- built-in starting points ----------------------------------------- */
var PRESETS = [
  { id: 'full', name: 'QuickGrade full gradebook',
    note: 'Everything, including per-question detail.',
    cols: ['name', 'sid', 'class', 'total', 'possible', 'pct01', 'letter',
           'mcCorrect', 'mcPoints', 'wPoints', 'pages', 'issues', 'mc:all', 'written:all'] },
  { id: 'simple', name: 'Name and percent only',
    note: 'The smallest thing most gradebooks will accept.',
    cols: ['name', 'sid', 'pct100'] },
  { id: 'lms', name: 'LMS-style (Canvas, Schoology, Moodle)',
    note: 'Student, id, email, section, then one column of points named after the test. ' +
          'Check the column names against your import screen the first time.',
    cols: ['sortname', 'sid', 'email', 'class', 'total'],
    heads: { total: '{{test}}' } },
  { id: 'sis', name: 'SIS-style (PowerSchool, Infinite Campus, Skyward)',
    note: 'District ID plus a single score. Most SIS imports are configured per district — ' +
          'match this to your own import template.',
    cols: ['sid', 'name', 'total', 'possible', 'pct100'] },
  { id: 'classroom', name: 'Google Classroom / Sheets',
    note: 'Email is how Classroom identifies a student, so add emails to your roster ' +
          'if you plan to import there.',
    cols: ['email', 'sortname', 'sid', 'total', 'pct100', 'letter'],
    heads: { total: '{{test}}' } },
  { id: 'analysis', name: 'Per-question analysis',
    note: 'One column per question — for spotting what the class missed.',
    cols: ['name', 'sid', 'pct100', 'mc:all'] }
];

/* ---- expand a format into concrete columns ---------------------------- */
function columnsOf(fmt, ctx) {
  var t = ctx.test, out = [];
  (fmt.cols || []).forEach(function (key) {
    var f = FIELD_BY_KEY[key];
    if (!f) return;
    var custom = (fmt.heads || {})[key];
    function head(dflt) {
      var h = custom || dflt;
      return String(h).replace(/\{\{test\}\}/g, t.title || 'Test')
                      .replace(/\{\{code\}\}/g, t.code || '')
                      .replace(/\{\{date\}\}/g, t.date || '');
    }
    if (f.expand === 'mc' || f.expand === 'mcRight') {
      for (var i = 0; i < t.mc.count; i++) {
        out.push({ key: key, idx: i, head: 'Q' + (i + 1) + (f.expand === 'mcRight' ? ' ok' : ''),
                   kind: f.expand });
      }
    } else if (f.expand === 'written') {
      (t.written || []).forEach(function (wq, wi) {
        out.push({ key: key, idx: wi, kind: 'written',
                   head: 'W' + (wi + 1) + ' (' + (wq.max || 0) + ')' });
      });
    } else {
      out.push({ key: key, head: head(f.head), kind: 'plain' });
    }
  });
  return out;
}

function valueFor(col, row, ctx) {
  var t = ctx.test, st = ctx.byId[S().normId(row.sid)] || {};
  var np = nameParts(row.name);
  switch (col.kind) {
    case 'mc': {
      var a = row.answers[col.idx];
      if (a === -3) return '';
      if (row.states[col.idx] === 'multi') return '**';
      return a < 0 ? '-' : S().LETTERS[a];
    }
    case 'mcRight': {
      var a2 = row.answers[col.idx], key = t.mc.key[col.idx];
      if (a2 === -3 || key == null) return '';
      return a2 === key ? 1 : 0;
    }
    case 'written': {
      var rec = (row.wRecords || {})[col.idx];
      return rec && typeof rec.p === 'number' ? rec.p : '';
    }
  }
  switch (col.key) {
    case 'name':      return row.name;
    case 'last':      return np.last;
    case 'first':     return np.first;
    case 'sortname':  return np.last ? np.last + ', ' + np.first : row.name;
    case 'sid':       return S().normId(row.sid);
    case 'email':     return st.email || '';
    case 'class':     return st.cls || t.className || '';
    case 'testTitle': return t.title || '';
    case 'testCode':  return t.code || '';
    case 'date':      return t.date || '';
    case 'total':     return row.scanned ? row.total : '';
    case 'possible':  return row.max;
    case 'pct100':    return row.scanned ? Math.round(row.pct * 1000) / 10 : '';
    case 'pct01':     return row.scanned ? Math.round(row.pct * 10000) / 10000 : '';
    case 'letter':    return row.scanned ? row.letter : '';
    case 'mcCorrect': return row.scanned ? row.correct : '';
    case 'mcCount':   return t.mc.count;
    case 'mcPoints':  return row.scanned ? row.mcPts : '';
    case 'wPoints':   return row.scanned ? row.wPts : '';
    case 'wPossible': return row.wMax;
    case 'pages':     return row.pagesSeen.join(' ');
    case 'scanned':   return row.scanned ? 'yes' : 'no';
    case 'blank':     return row.scanned ? row.blank : '';
    case 'multi':     return row.scanned ? row.multi : '';
    case 'issues': {
      var out = [];
      if (!row.scanned) out.push('not scanned');
      if (row.missing.length) out.push('missing p' + row.missing.join('/p'));
      if (row.multi) out.push(row.multi + ' double-marked');
      if (row.blank) out.push(row.blank + ' blank');
      return out.join('; ');
    }
  }
  return '';
}

/**
 * buildRows(fmt, ctx, opts) -> { head:[], rows:[[]] }
 * opts.onlyScanned drops students with nothing scanned, which is what most
 * gradebook imports want (an empty row can overwrite an existing grade).
 */
function buildRows(fmt, ctx, opts) {
  opts = opts || {};
  var cols = columnsOf(fmt, ctx);
  var rows = ctx.results.rows.filter(function (r) { return !opts.onlyScanned || r.scanned; });
  return {
    head: cols.map(function (c) { return c.head; }),
    rows: rows.map(function (r) {
      return cols.map(function (c) { return valueFor(c, r, ctx); });
    })
  };
}

/** A structured payload for an endpoint — self-describing, versioned. */
function buildPayload(fmt, ctx, opts) {
  var built = buildRows(fmt, ctx, opts);
  var t = ctx.test;
  return {
    source: 'quickgrade', version: 1,
    test: { title: t.title, code: t.code, date: t.date, classes: t.classes || [],
            pointsPossible: (t.mc.count * t.mc.points) +
              (t.written || []).reduce(function (a, w) { return a + (w.max || 0); }, 0) },
    format: { id: fmt.id, name: fmt.name },
    columns: built.head,
    rows: built.rows
  };
}

global.QG.ExportMap = {
  FIELDS: FIELDS, FIELD_BY_KEY: FIELD_BY_KEY, PRESETS: PRESETS,
  columnsOf: columnsOf, buildRows: buildRows, buildPayload: buildPayload,
  nameParts: nameParts
};
})(window);
