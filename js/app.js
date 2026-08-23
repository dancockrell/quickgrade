/* QuickGrade — app.js : state, routing, editors, grading and exports. */
(function (global) {
'use strict';

var Q = global.QG, S = Q.Sheet, X = Q.OOXML, Scanner = Q.Scanner;
var $ = Q.$, $$ = Q.$$, el = Q.el, on = Q.on;

/* ================================================================ state */
var State = {
  tests: [], test: null, pages: [],
  students: [], byId: {},
  scans: [], grades: {},
  results: null
};

var DEFAULT_SCALE = [[90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [0, 'F']];

var TOPSHEET_OPTS = [
  { k: 'showScoreBand',   d: true,  t: 'Score summary band' },
  { k: 'showPercent',     d: true,  t: 'Percent' },
  { k: 'showLetter',      d: true,  t: 'Letter grade' },
  { k: 'showMc',          d: true,  t: 'Multiple-choice detail table' },
  { k: 'onlyWrong',       d: false, t: 'Only list questions missed' },
  { k: 'showQuestionText',d: false, t: 'Include question text (if entered)' },
  { k: 'showTopic',       d: false, t: 'Include topic / standard column' },
  { k: 'showClassPct',    d: false, t: 'Show % of class that got it right' },
  { k: 'showWritten',     d: true,  t: 'Written-answer scores' },
  { k: 'showWrittenNotes',d: true,  t: 'Written-answer teacher notes' },
  { k: 'showMissedList',  d: false, t: 'Compact "missed" list at top' },
  { k: 'commentBox',      d: true,  t: 'Blank teacher comment box' },
  { k: 'commentLines',    d: false, t: 'Ruled lines inside comment box' },
  { k: 'sigTeacher',      d: false, t: 'Teacher signature line' },
  { k: 'sigParent',       d: false, t: 'Parent signature line' },
  { k: 'sigStudent',      d: false, t: 'Student corrections / retake line' },
  { k: 'showStudentId',   d: true,  t: 'Print student ID' },
  { k: 'showDate',        d: true,  t: 'Print test date' },
  { k: 'showClassAvg',    d: false, t: 'Class average for comparison' },
  { k: 'showRank',        d: false, t: 'Rank in class' },
  { k: 'pageBreakEach',   d: true,  t: 'One page per student' }
];

function defaultOptions() {
  var o = { prefillId: true, wPerPage: 2, instructions: '', scale: DEFAULT_SCALE.slice(), footer: '', topsheet: {} };
  TOPSHEET_OPTS.forEach(function (t) { o.topsheet[t.k] = t.d; });
  return o;
}
function newTest() {
  return {
    id: Q.uid('t'), title: '', className: '', date: Q.todayISO(),
    code: String(Math.floor(Math.random() * 900) + 100),
    mc: { count: 20, choices: 5, key: [], points: 1, text: [], topic: [] },
    written: [], options: defaultOptions(), createdAt: Date.now()
  };
}
function normalizeTest(t) {
  t.mc = t.mc || {};
  t.mc.count = t.mc.count || 0;
  t.mc.choices = t.mc.choices || 5;
  t.mc.key = t.mc.key || [];
  t.mc.points = t.mc.points == null ? 1 : t.mc.points;
  t.mc.text = t.mc.text || [];
  t.mc.topic = t.mc.topic || [];
  t.written = t.written || [];
  /* Merge nested `topsheet` explicitly: a plain Object.assign would let a
   * stored `topsheet:{}` replace the whole defaults object and silently turn
   * every top-sheet section off. */
  var base = defaultOptions();
  var defTop = base.topsheet;
  var userTop = (t.options && t.options.topsheet) || {};
  t.options = Object.assign(base, t.options || {});
  t.options.topsheet = Object.assign({}, defTop, userTop);
  if (!t.options.scale || !t.options.scale.length) t.options.scale = DEFAULT_SCALE.slice();
  return t;
}

/* ================================================================ boot */
function storageBanner() {
  var mode = Q.DB.mode();
  if (mode === 'idb') return;
  var box = $('#storageWarn');
  var msg = mode === 'local'
    ? 'Running in limited mode because this page was opened straight from a file. Scores and rosters save, but scanned images are lost on reload — and the camera will not open.'
    : 'Nothing can be saved in this browser. Work will be lost when you close the tab.';
  box.innerHTML = '';
  box.appendChild(el('span', { html: '<b>Heads up:</b> ' + Q.esc(msg) +
    ' Close this and run <b>Start QuickGrade.bat</b> instead.' }));
  box.appendChild(el('button', { text: '×', title: 'Dismiss',
    onclick: function () { box.hidden = true; } }));
  box.hidden = false;
}

function boot() {
  Q.DB.ready().then(storageBanner);
  Promise.all([Q.DB.all('tests'), Q.DB.all('students')]).then(function (r) {
    State.tests = (r[0] || []).map(normalizeTest).sort(function (a, b) { return b.createdAt - a.createdAt; });
    State.students = r[1] || [];
    indexStudents();
    var last = Q.Prefs.get('testId', null);
    var t = State.tests.filter(function (x) { return x.id === last; })[0] || State.tests[0] || null;
    return selectTest(t);
  }).then(function () {
    wireUI();
    renderTests();
    renderRosterView();
    route(Q.Prefs.get('view', 'tests'));
  }).catch(function (e) {
    console.error(e);
    Q.toast('Startup problem: ' + e.message, 'err', 8000);
  });
}

function indexStudents() {
  State.byId = {};
  State.students.forEach(function (s) { State.byId[s.sid] = s; });
}

function selectTest(t) {
  State.test = t ? normalizeTest(t) : null;
  State.pages = t ? S.layoutTest(State.test) : [];
  Q.Prefs.set('testId', t ? t.id : null);
  updateCtx();
  if (!t) { State.scans = []; State.grades = {}; State.results = null; return Promise.resolve(); }
  return Promise.all([Q.DB.all('scans'), Q.DB.get('kv', 'grades:' + t.id)]).then(function (r) {
    State.scans = (r[0] || []).filter(function (s) { return s.testId === t.id; });
    State.grades = (r[1] && r[1].v) || {};
    recompute();
  });
}

function updateCtx() {
  var t = State.test;
  $('#ctxLabel').textContent = t ? (t.title || 'Untitled') + ' · ' + (t.className || 'no class') +
    ' · code ' + t.code + ' · ' + State.pages.length + 'pp' : 'No test selected';
  var pill = $('#pillTest');
  if (pill) pill.textContent = t ? (t.title || 'Untitled') + ' (' + t.code + ')' : 'No test';
}

function saveTest() {
  return Q.DB.put('tests', State.test).then(function () {
    State.pages = S.layoutTest(State.test);
    updateCtx();
  });
}
function saveGrades() { return Q.DB.put('kv', { k: 'grades:' + State.test.id, v: State.grades }); }

/* ============================================================== router */
function route(name) {
  if (name === 'scan' && !State.test) { Q.toast('Create or select a test first.', 'err'); name = 'tests'; }
  $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
  $$('.navbtn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
  Q.Prefs.set('view', name);
  if (name !== 'scan') Scanner.stop();
  if (name === 'tests') renderTests();
  if (name === 'roster') renderRosterView();
  if (name === 'review') renderReview();
  if (name === 'written') renderWrittenGrading();
  if (name === 'export') renderExport();
  if (name === 'scan') { Q.Audio2.unlock(); updateCtx(); }
}

/* ============================================================ results */
function studentName(sid) {
  var s = State.byId[sid];
  return s ? s.name : (sid ? 'ID ' + sid : 'Unknown');
}
function classStudents() {
  var t = State.test;
  if (!t) return [];
  var list = State.students.filter(function (s) { return (s.cls || '') === (t.className || ''); });
  if (!list.length) list = State.students.slice();
  return list.sort(function (a, b) { return Q.sortName(a.name).localeCompare(Q.sortName(b.name)); });
}

function recompute() {
  var t = State.test;
  if (!t) { State.results = null; return; }
  var nPages = State.pages.length;
  var byStudent = {};

  State.scans.forEach(function (sc) {
    if (!sc.sid) return;
    var e = byStudent[sc.sid] || (byStudent[sc.sid] = { sid: sc.sid, scans: [], pages: {} });
    /* newest scan wins for a given page */
    var prev = e.pages[sc.page];
    if (!prev || prev.ts < sc.ts) e.pages[sc.page] = sc;
  });
  Object.keys(byStudent).forEach(function (sid) {
    var e = byStudent[sid];
    e.scans = Object.keys(e.pages).map(function (p) { return e.pages[p]; });
  });

  var roster = classStudents();
  var seen = {};
  var rows = [];

  function build(sid, name) {
    var e = byStudent[sid];
    var answers = new Array(t.mc.count).fill(-3);   // -3 = page never scanned
    var states = {};
    var pagesSeen = [];
    if (e) {
      e.scans.forEach(function (sc) {
        pagesSeen.push(sc.page);
        Object.keys(sc.answers || {}).forEach(function (k) {
          answers[+k] = sc.answers[k];
          states[+k] = (sc.states || {})[k] || 'ok';
        });
      });
    }
    pagesSeen.sort(function (a, b) { return a - b; });
    var missing = [];
    for (var p = 1; p <= nPages; p++) if (pagesSeen.indexOf(p) < 0) missing.push(p);

    var correct = 0, blank = 0, multi = 0, unscanned = 0;
    for (var i = 0; i < t.mc.count; i++) {
      if (answers[i] === -3) { unscanned++; continue; }
      if (states[i] === 'multi') { multi++; continue; }
      if (answers[i] < 0) { blank++; continue; }
      if (t.mc.key[i] != null && answers[i] === t.mc.key[i]) correct++;
    }
    var mcPts = correct * (t.mc.points || 0);
    var mcMax = t.mc.count * (t.mc.points || 0);

    var g = State.grades[sid] || {};
    var wPts = 0, wMax = 0, wGraded = 0;
    (t.written || []).forEach(function (wq, wi) {
      wMax += (wq.max || 0);
      var rec = (g.w || {})[wi];
      if (rec && typeof rec.p === 'number') { wPts += rec.p; wGraded++; }
    });

    var max = mcMax + wMax;
    var total = mcPts + wPts;
    var pct = max > 0 ? total / max : 0;
    return {
      sid: sid, name: name || studentName(sid),
      answers: answers, states: states,
      pagesSeen: pagesSeen, missing: missing, scanned: pagesSeen.length > 0,
      correct: correct, blank: blank, multi: multi, unscanned: unscanned,
      mcPts: Q.round2(mcPts), mcMax: Q.round2(mcMax),
      wPts: Q.round2(wPts), wMax: Q.round2(wMax), wGraded: wGraded,
      total: Q.round2(total), max: Q.round2(max), pct: pct,
      letter: letterFor(pct * 100),
      comment: g.comment || '', wRecords: g.w || {}
    };
  }

  roster.forEach(function (s) { seen[s.sid] = 1; rows.push(build(s.sid, s.name)); });
  Object.keys(byStudent).forEach(function (sid) {
    if (!seen[sid]) rows.push(build(sid, studentName(sid)));
  });

  /* class stats over students who actually have scans */
  var scannedRows = rows.filter(function (r) { return r.scanned; });
  var itemPct = [];
  for (var qi = 0; qi < t.mc.count; qi++) {
    var n = 0, c = 0, dist = [];
    for (var k = 0; k < t.mc.choices; k++) dist.push(0);
    var nBlank = 0, nMulti = 0;
    scannedRows.forEach(function (r) {
      var a = r.answers[qi];
      if (a === -3) return;
      n++;
      if (r.states[qi] === 'multi') { nMulti++; return; }
      if (a < 0) { nBlank++; return; }
      dist[a]++;
      if (t.mc.key[qi] != null && a === t.mc.key[qi]) c++;
    });
    itemPct.push({ n: n, correct: c, pct: n ? c / n : 0, dist: dist, blank: nBlank, multi: nMulti });
  }
  var avg = scannedRows.length
    ? scannedRows.reduce(function (a, r) { return a + r.pct; }, 0) / scannedRows.length : 0;

  var ranked = scannedRows.slice().sort(function (a, b) { return b.total - a.total; });
  ranked.forEach(function (r, i) { r.rank = i + 1; });
  rows.forEach(function (r) { r.rankOf = ranked.length; });

  var unresolved = State.scans.filter(function (sc) { return !sc.sid || !State.byId[sc.sid]; });

  State.results = { rows: rows, scannedRows: scannedRows, itemPct: itemPct, avg: avg, unresolved: unresolved };
  updateBadges();
  return State.results;
}

function letterFor(pct100) {
  var scale = (State.test && State.test.options.scale) || DEFAULT_SCALE;
  for (var i = 0; i < scale.length; i++) if (pct100 >= scale[i][0]) return scale[i][1];
  return scale.length ? scale[scale.length - 1][1] : '';
}

function updateBadges() {
  var r = State.results;
  var b1 = $('#badgeUnres'), b2 = $('#badgeWritten');
  var n1 = r ? r.unresolved.length : 0;
  b1.hidden = !n1; b1.textContent = n1;
  var pend = pendingWritten().length;
  b2.hidden = !pend; b2.textContent = pend;
}

/* ============================================================== TESTS */
function renderTests() {
  var box = $('#testList');
  box.innerHTML = '';
  if (!State.tests.length) {
    box.style.display = 'block';
    box.appendChild(el('div', { class: 'empty' }, [
      el('strong', { text: 'No tests yet' }),
      el('div', { text: 'A test holds your answer key and the written questions. ' +
        'Once it exists you can print answer sheets and start scanning.' }),
      el('button', { class: 'btn go', text: 'Create your first test',
        onclick: function () { openEditor(null); } })
    ]));
    return;
  }
  box.style.display = '';
  State.tests.forEach(function (t) {
    var isSel = State.test && State.test.id === t.id;
    var card = el('div', { class: 'card' + (isSel ? ' sel' : '') }, [
      el('h4', { text: t.title || 'Untitled test' }),
      el('div', { class: 'meta', text: (t.className || 'No class') + ' · ' + (t.date || '') }),
      el('div', { class: 'meta', text: t.mc.count + ' MC · ' + (t.written || []).length +
        ' written · code ' + t.code + ' · ' + S.layoutTest(t).length + ' page(s)' }),
      el('div', { class: 'cardbtns' }, [
        el('button', { class: 'btn sm' + (isSel ? '' : ' go'), text: isSel ? 'Selected' : 'Select',
          onclick: function (e) { e.stopPropagation(); selectTest(t).then(function () { renderTests(); renderRosterView(); }); } }),
        el('button', { class: 'btn sm', text: 'Edit',
          onclick: function (e) { e.stopPropagation(); selectTest(t).then(function () { renderTests(); openEditor(t); }); } }),
        el('button', { class: 'btn sm', text: 'Duplicate',
          onclick: function (e) { e.stopPropagation(); duplicateTest(t); } })
      ])
    ]);
    on(card, 'click', function () { selectTest(t).then(function () { renderTests(); renderRosterView(); }); });
    box.appendChild(card);
  });
}

function duplicateTest(t) {
  var c = JSON.parse(JSON.stringify(t));
  c.id = Q.uid('t'); c.createdAt = Date.now();
  c.title = (t.title || 'Untitled') + ' (copy)';
  c.code = String(Math.floor(Math.random() * 900) + 100);
  Q.DB.put('tests', c).then(function () {
    State.tests.unshift(normalizeTest(c));
    renderTests();
    Q.toast('Duplicated. Give the copy its own test code before printing.', 'good', 5000);
  });
}

var editing = null;
function openEditor(t) {
  editing = t ? JSON.parse(JSON.stringify(t)) : newTest();
  normalizeTest(editing);
  $('#testEditor').hidden = false;
  $('#editorTitle').textContent = t ? 'Edit test' : 'New test';
  $('#btnDeleteTest').hidden = !t;
  $('#f_title').value = editing.title;
  $('#f_class').value = editing.className;
  $('#f_date').value = editing.date;
  $('#f_code').value = editing.code;
  $('#f_mcCount').value = editing.mc.count;
  $('#f_choices').value = editing.mc.choices;
  $('#f_mcPoints').value = editing.mc.points;
  $('#f_prefillId').checked = !!editing.options.prefillId;
  $('#f_wPerPage').value = editing.options.wPerPage;
  $('#f_instr').value = editing.options.instructions || '';
  renderKeyGrid();
  renderWrittenList();
  renderTopsheetOpts($('#topsheetOpts'), editing);
  $('#testEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeEditor() { $('#testEditor').hidden = true; editing = null; }

function renderKeyGrid() {
  var g = $('#keyGrid');
  g.innerHTML = '';
  var n = editing.mc.count, ch = editing.mc.choices;
  if (!n) { g.appendChild(el('span', { class: 'hint', text: 'No multiple-choice questions.' })); return; }
  for (var i = 0; i < n; i++) (function (i) {
    var opts = el('div', { class: 'opts' });
    for (var k = 0; k < ch; k++) (function (k) {
      opts.appendChild(el('button', {
        class: 'opt' + (editing.mc.key[i] === k ? ' on' : ''), text: S.LETTERS[k],
        'data-q': i, 'data-k': k,
        onclick: function () {
          editing.mc.key[i] = (editing.mc.key[i] === k) ? null : k;
          renderKeyGrid();
          var next = g.querySelector('[data-q="' + Math.min(n - 1, i + 1) + '"]');
          if (next) next.focus();
        }
      }));
    })(k);
    g.appendChild(el('div', { class: 'keyitem' }, [el('span', { class: 'qn', text: (i + 1) + '.' }), opts]));
  })(i);

  /* type letters continuously: focus any option and press A..E */
  on(g, 'keydown', function (e) {
    var btn = e.target.closest ? e.target.closest('.opt') : null;
    if (!btn) return;
    var qi = +btn.dataset.q;
    var idx = S.LETTERS.indexOf(e.key.toUpperCase());
    if (idx >= 0 && idx < editing.mc.choices) {
      e.preventDefault();
      editing.mc.key[qi] = idx;
      renderKeyGrid();
      var nb = g.querySelector('[data-q="' + Math.min(editing.mc.count - 1, qi + 1) + '"]');
      if (nb) nb.focus();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); editing.mc.key[qi] = null; renderKeyGrid();
      var pb = g.querySelector('[data-q="' + Math.max(0, qi - 1) + '"]');
      if (pb) pb.focus();
    }
  });
}

function renderWrittenList() {
  var box = $('#writtenList');
  box.innerHTML = '';
  (editing.written || []).forEach(function (w, i) {
    var row = el('div', { class: 'wrow' }, [
      el('input', { value: w.label || '', placeholder: 'Question ' + (i + 1) + ' prompt / label',
        oninput: function (e) { w.label = e.target.value; } }),
      el('input', { type: 'number', min: '0', step: '0.5', value: w.max == null ? 5 : w.max,
        title: 'Max points', oninput: function (e) { w.max = +e.target.value || 0; } }),
      el('select', { onchange: function (e) { w.kind = e.target.value; } },
        ['short', 'essay', 'fill'].map(function (k) {
          return el('option', { value: k, selected: (w.kind || 'short') === k },
            k === 'short' ? 'Short answer' : k === 'essay' ? 'Essay' : 'Fill-in');
        })),
      el('input', { value: w.expected || '', placeholder: 'Expected answer (optional)',
        oninput: function (e) { w.expected = e.target.value; } }),
      el('button', { class: 'btn sm danger', text: '×',
        onclick: function () { editing.written.splice(i, 1); renderWrittenList(); } })
    ]);
    box.appendChild(row);
  });
  if (!editing.written.length) box.appendChild(el('p', { class: 'hint', text: 'None yet.' }));
}

function renderTopsheetOpts(box, t) {
  box.innerHTML = '';
  TOPSHEET_OPTS.forEach(function (o) {
    box.appendChild(el('label', { class: 'chk' }, [
      el('input', { type: 'checkbox', checked: !!t.options.topsheet[o.k],
        onchange: function (e) {
          t.options.topsheet[o.k] = e.target.checked;
          if (t === State.test) saveTest();
        } }),
      o.t
    ]));
  });
  box.appendChild(el('label', { class: 'optfoot' }, [
    el('span', { text: 'Footer note printed on every top sheet' }),
    el('input', { value: t.options.footer || '', placeholder: 'e.g. Corrections due Friday for half credit back',
      oninput: function (e) { t.options.footer = e.target.value; if (t === State.test) saveTest(); } })
  ]));
}

function collectEditor() {
  editing.title = $('#f_title').value.trim();
  editing.className = $('#f_class').value.trim();
  editing.date = $('#f_date').value;
  editing.code = S.digits($('#f_code').value || editing.code, 3).join('');
  editing.mc.count = Q.clamp(parseInt($('#f_mcCount').value, 10) || 0, 0, 300);
  editing.mc.choices = parseInt($('#f_choices').value, 10) || 5;
  editing.mc.points = parseFloat($('#f_mcPoints').value);
  if (isNaN(editing.mc.points)) editing.mc.points = 1;
  editing.options.prefillId = $('#f_prefillId').checked;
  editing.options.wPerPage = Q.clamp(parseInt($('#f_wPerPage').value, 10) || 2, 1, 6);
  editing.options.instructions = $('#f_instr').value.trim();
  editing.mc.key = editing.mc.key.slice(0, editing.mc.count);
  return editing;
}

/* ============================================================= ROSTER */
function allClasses() {
  var set = {};
  State.students.forEach(function (s) { if (s.cls) set[s.cls] = 1; });
  State.tests.forEach(function (t) { if (t.className) set[t.className] = 1; });
  return Object.keys(set).sort();
}
function currentClass() {
  var sel = $('#rosterClass');
  return sel && sel.value ? sel.value : (State.test ? State.test.className : '');
}
function renderRosterView() {
  var sel = $('#rosterClass');
  var classes = allClasses();
  var want = sel.value || (State.test && State.test.className) || classes[0] || '';
  sel.innerHTML = '';
  classes.forEach(function (c) { sel.appendChild(el('option', { value: c, selected: c === want }, c)); });
  if (!classes.length) sel.appendChild(el('option', { value: '' }, '(no classes yet)'));
  renderRosterTable();
}
function renderRosterTable() {
  var cls = currentClass();
  var list = State.students.filter(function (s) { return (s.cls || '') === cls; })
    .sort(function (a, b) { return Q.sortName(a.name).localeCompare(Q.sortName(b.name)); });
  $('#rosterCount').textContent = list.length ? '(' + list.length + ')' : '';
  var box = $('#rosterTable');
  box.innerHTML = '';
  var tb = el('tbody');
  list.forEach(function (s) {
    tb.appendChild(el('tr', {}, [
      el('td', { text: s.name }),
      el('td', { class: 'dim', text: s.sid }),
      el('td', {}, [el('button', {
        class: 'btn sm danger', text: '×', title: 'Remove student',
        onclick: function () {
          Q.confirmBox('Remove ' + s.name + ' from the roster?').then(function (ok) {
            if (!ok) return;
            Q.DB.del('students', s.sid).then(function () {
              State.students = State.students.filter(function (x) { return x.sid !== s.sid; });
              indexStudents(); renderRosterTable(); recompute();
            });
          });
        }
      })])
    ]));
  });
  box.appendChild(el('table', {}, [
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Name' }), el('th', { text: 'ID' }), el('th', {})])]), tb
  ]));
}
function nextSid() {
  var max = 100000;
  State.students.forEach(function (s) {
    var n = parseInt(s.sid, 10);
    if (!isNaN(n) && n > max && String(s.sid) !== S.L.KEY_SID) max = n;
  });
  return String(max + 1);
}
function saveRosterPaste() {
  var cls = currentClass();
  if (!cls) { Q.toast('Create a class first.', 'err'); return; }
  var lines = $('#rosterPaste').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) { Q.toast('Nothing to add.', 'err'); return; }
  var add = [], taken = {};
  State.students.forEach(function (s) { taken[s.sid] = 1; });
  var counter = parseInt(nextSid(), 10);
  lines.forEach(function (line) {
    var m = line.split(/\s*[,\t]\s*/);
    var name = m[0].trim();
    var sid = (m[1] || '').replace(/\D/g, '');
    if (!name) return;
    if (sid) { sid = S.digits(sid, 6).join(''); }
    else {
      var existing = State.students.filter(function (s) {
        return s.cls === cls && s.name.toLowerCase() === name.toLowerCase();
      })[0];
      if (existing) sid = existing.sid;
      else { while (taken[String(counter)]) counter++; sid = String(counter); counter++; }
    }
    if (sid === S.L.KEY_SID) { Q.toast('999999 is reserved for the answer key — skipped ' + name, 'err'); return; }
    taken[sid] = 1;
    add.push({ sid: sid, name: name, cls: cls });
  });
  Q.DB.putMany('students', add).then(function () {
    add.forEach(function (s) {
      var i = State.students.findIndex(function (x) { return x.sid === s.sid; });
      if (i >= 0) State.students[i] = s; else State.students.push(s);
    });
    indexStudents(); renderRosterTable(); recompute();
    $('#rosterPaste').value = '';
    Q.toast('Saved ' + add.length + ' student' + (add.length === 1 ? '' : 's') + '.', 'good');
  });
}

function printSheets(mode) {
  var t = State.test;
  if (!t) { Q.toast('Select a test first.', 'err'); return; }
  var people, opts = { prefill: false, keyMode: false };
  if (mode === 'personal') {
    people = State.students.filter(function (s) { return (s.cls || '') === (t.className || ''); })
      .sort(function (a, b) { return Q.sortName(a.name).localeCompare(Q.sortName(b.name)); });
    if (!people.length) { Q.toast('No students in class "' + (t.className || '') + '". Add a roster first.', 'err', 5000); return; }
    opts.prefill = !!t.options.prefillId;
  } else if (mode === 'key') {
    people = [{ sid: S.L.KEY_SID, name: 'ANSWER KEY', cls: t.className }];
    opts.prefill = true; opts.keyMode = true;
  } else {
    people = [{}];
  }
  Q.openPrintWindow(S.renderSheets(t, people, opts), false);
}

/* =============================================================== SCAN */
Scanner.hooks = {
  getTest: function () { return State.test; },
  getPages: function () { return State.pages; },
  refresh: function () { recompute(); },
  saveScan: function (record, blobs) {
    var t = State.test;

    /* the printed answer-key sheet teaches the app its own key */
    if (record.sid === S.L.KEY_SID) {
      var page = State.pages[record.page - 1];
      page.mc.forEach(function (item) {
        var a = record.answers[item.q];
        if (a >= 0) t.mc.key[item.q] = a;
      });
      return saveTest().then(function () { recompute(); return { status: 'key' }; });
    }

    var known = record.sid && State.byId[record.sid];
    var replaced = null;
    if (record.sid) {
      replaced = State.scans.filter(function (s) {
        return s.sid === record.sid && s.page === record.page;
      })[0];
    }

    var chain = Promise.resolve();
    if (replaced) {
      var oldBlobs = collectBlobIds(replaced);
      chain = Q.DB.del('scans', replaced.id).then(function () {
        State.scans = State.scans.filter(function (s) { return s.id !== replaced.id; });
        if (oldBlobs.length) return Q.DB.delMany('blobs', oldBlobs);
      });
    }
    return chain
      .then(function () { return blobs.length ? Q.DB.putMany('blobs', blobs) : null; })
      .then(function () { return Q.DB.put('scans', record); })
      .then(function () {
        State.scans.push(record);
        recompute();
        if (!record.sid) return { status: 'no-id' };
        if (!known) return { status: 'unknown-id' };
        var mine = State.scans.filter(function (s) { return s.sid === record.sid; });
        var have = {}; mine.forEach(function (s) { have[s.page] = 1; });
        var missing = [];
        for (var p = 1; p <= State.pages.length; p++) if (!have[p]) missing.push(p);
        return {
          status: replaced ? 'replaced' : 'ok',
          name: known.name,
          complete: missing.length === 0,
          missingPages: missing
        };
      });
  }
};
function collectBlobIds(sc) {
  var ids = [];
  if (sc.nameCrop) ids.push(sc.nameCrop);
  if (sc.classCrop) ids.push(sc.classCrop);
  if (sc.pageImg) ids.push(sc.pageImg);
  Object.keys(sc.written || {}).forEach(function (k) { ids.push(sc.written[k]); });
  return ids;
}
function deleteScan(sc) {
  var ids = collectBlobIds(sc);
  return Q.DB.del('scans', sc.id)
    .then(function () { return ids.length ? Q.DB.delMany('blobs', ids) : null; })
    .then(function () {
      State.scans = State.scans.filter(function (s) { return s.id !== sc.id; });
      recompute();
    });
}

/* ============================================================= REVIEW */
function renderReview() {
  recompute();
  var r = State.results;
  var box = $('#unresolvedBox');
  box.innerHTML = '';
  if (!r) return;

  if (r.unresolved.length) {
    var wrap = el('div', { class: 'unres' }, [
      el('h3', { text: '⚠ ' + r.unresolved.length + ' sheet' + (r.unresolved.length === 1 ? '' : 's') +
        ' could not be matched to a student' })
    ]);
    r.unresolved.forEach(function (sc) {
      var row = el('div', { class: 'unrow' });
      row.appendChild(el('img', { src: sc.thumb, alt: 'sheet' }));
      var crop = el('img', { alt: 'handwritten name', style: 'height:46px;flex:0 0 auto' });
      if (sc.nameCrop) {
        Q.DB.get('blobs', sc.nameCrop).then(function (b) { if (b) crop.src = b.data; });
      }
      row.appendChild(crop);
      row.appendChild(el('span', { class: 'dim',
        text: 'page ' + sc.page + (sc.sid ? ' · ID ' + sc.sid + ' (not on roster)' : ' · no ID bubbled') }));
      var sel = el('select', { class: 'sel sm' }, [el('option', { value: '' }, 'Assign to…')].concat(
        classStudents().map(function (s) { return el('option', { value: s.sid }, s.name + ' · ' + s.sid); })
      ));
      row.appendChild(sel);
      row.appendChild(el('button', {
        class: 'btn sm go', text: 'Assign',
        onclick: function () {
          if (!sel.value) { Q.toast('Pick a student first.', 'err'); return; }
          assignScan(sc, sel.value);
        }
      }));
      row.appendChild(el('button', {
        class: 'btn sm', text: 'View sheet',
        onclick: function () { viewSheet(sc); }
      }));
      row.appendChild(el('button', {
        class: 'btn sm danger', text: 'Delete',
        onclick: function () {
          Q.confirmBox('Delete this scan?').then(function (ok) { if (ok) deleteScan(sc).then(renderReview); });
        }
      }));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }

  var onlyProblems = $('#showMissingOnly').checked;
  var rows = r.rows.filter(function (x) {
    return !onlyProblems || !x.scanned || x.missing.length || x.multi || x.blank;
  });

  var tb = el('tbody');
  rows.forEach(function (x) {
    var pageCells = [];
    for (var p = 1; p <= State.pages.length; p++) {
      pageCells.push(el('span', {
        class: x.pagesSeen.indexOf(p) >= 0 ? 'ok' : 'bad',
        text: (x.pagesSeen.indexOf(p) >= 0 ? '✓' : '✗') + p, style: 'margin-right:6px'
      }));
    }
    var flags = [];
    if (!x.scanned) flags.push('not scanned');
    else {
      if (x.missing.length) flags.push('missing p' + x.missing.join(',p'));
      if (x.multi) flags.push(x.multi + ' double-marked');
      if (x.blank) flags.push(x.blank + ' blank');
    }
    tb.appendChild(el('tr', {}, [
      el('td', { text: x.name }),
      el('td', { class: 'dim', text: x.sid }),
      el('td', {}, pageCells),
      el('td', { text: x.scanned ? x.correct + '/' + State.test.mc.count : '—' }),
      el('td', { text: State.test.written.length ? x.wGraded + '/' + State.test.written.length : '—' }),
      el('td', { text: x.scanned ? x.total + '/' + x.max + '  (' + Math.round(x.pct * 100) + '%)' : '—' }),
      el('td', { class: flags.length ? 'warnc' : 'dim', text: flags.join(' · ') || 'ok' }),
      el('td', {}, [el('button', {
        class: 'btn sm', text: 'Sheets',
        onclick: function () { viewStudentSheets(x); }
      })])
    ]));
  });
  var t = el('table', {}, [
    el('thead', {}, [el('tr', {}, ['Student', 'ID', 'Pages', 'MC', 'Written', 'Score', 'Notes', ''].map(function (h) {
      return el('th', { text: h });
    }))]), tb
  ]);
  var host = $('#reviewTable');
  host.innerHTML = '';
  host.appendChild(el('div', { class: 'tbl' }, [t]));
}

function assignScan(sc, sid) {
  var dup = State.scans.filter(function (s) { return s.sid === sid && s.page === sc.page && s.id !== sc.id; })[0];
  var chain = dup ? deleteScan(dup) : Promise.resolve();
  chain.then(function () {
    sc.sid = sid;
    sc.flags = (sc.flags || []).filter(function (f) { return f !== 'no-id' && f !== 'partial-id'; });
    return Q.DB.put('scans', sc);
  }).then(function () {
    recompute(); renderReview();
    Q.toast('Assigned to ' + studentName(sid) + '.', 'good');
  });
}

function viewSheet(sc) {
  var body = el('div', {}, [el('h3', { text: 'Scanned sheet — page ' + sc.page })]);
  var img = el('img', { class: 'namecrop', src: sc.thumb, style: 'max-width:100%' });
  body.appendChild(img);
  if (sc.pageImg) Q.DB.get('blobs', sc.pageImg).then(function (b) { if (b) img.src = b.data; });
  if (sc.nameCrop) {
    body.appendChild(el('p', { class: 'hint', text: 'Name written on the sheet:' }));
    var c = el('img', { class: 'namecrop' });
    Q.DB.get('blobs', sc.nameCrop).then(function (b) { if (b) c.src = b.data; });
    body.appendChild(c);
  }
  Q.modal(body);
}
function viewStudentSheets(x) {
  var mine = State.scans.filter(function (s) { return s.sid === x.sid; })
    .sort(function (a, b) { return a.page - b.page; });
  var body = el('div', {}, [el('h3', { text: x.name + ' — ' + mine.length + ' page(s)' })]);
  if (!mine.length) body.appendChild(el('p', { class: 'hint', text: 'Nothing scanned yet.' }));
  mine.forEach(function (sc) {
    body.appendChild(el('p', { class: 'hint', text: 'Page ' + sc.page +
      ' · scanned ' + new Date(sc.ts).toLocaleTimeString() }));
    var img = el('img', { class: 'namecrop', src: sc.thumb });
    if (sc.pageImg) Q.DB.get('blobs', sc.pageImg).then(function (b) { if (b) img.src = b.data; });
    body.appendChild(img);
    body.appendChild(el('button', { class: 'btn sm danger', text: 'Delete this page scan',
      onclick: function () {
        Q.confirmBox('Delete page ' + sc.page + ' for ' + x.name + '?').then(function (ok) {
          if (ok) deleteScan(sc).then(function () { renderReview(); });
        });
      } }));
  });
  Q.modal(body);
}

/* ==================================================== WRITTEN GRADING */
var GState = { qIdx: 0, list: [], pos: 0, digitBuf: '', digitAt: 0 };

function pendingWritten() {
  var t = State.test;
  if (!t || !t.written.length || !State.results) return [];
  var out = [];
  t.written.forEach(function (wq, wi) {
    State.results.rows.forEach(function (r) {
      if (!r.scanned) return;
      var rec = (r.wRecords || {})[wi];
      if (!rec || typeof rec.p !== 'number') out.push({ wi: wi, sid: r.sid });
    });
  });
  return out;
}

function buildGradeList(wi) {
  var out = [];
  (State.results ? State.results.rows : []).forEach(function (r) {
    if (!r.scanned) return;
    var sc = State.scans.filter(function (s) {
      return s.sid === r.sid && s.written && s.written[wi] != null;
    })[0];
    out.push({ sid: r.sid, name: r.name, blobId: sc ? sc.written[wi] : null, scan: sc || null });
  });
  return out;
}

function renderWrittenGrading() {
  recompute();
  var t = State.test;
  var sel = $('#gradeQ');
  sel.innerHTML = '';
  if (!t || !t.written.length) {
    $('#gradeImage').removeAttribute('src');
    $('#gradeProgress').textContent = 'This test has no written questions.';
    $('#pointsRow').innerHTML = '';
    sel.appendChild(el('option', {}, '—'));
    return;
  }
  t.written.forEach(function (wq, i) {
    var done = 0, total = 0;
    (State.results.rows || []).forEach(function (r) {
      if (!r.scanned) return;
      total++;
      var rec = (r.wRecords || {})[i];
      if (rec && typeof rec.p === 'number') done++;
    });
    sel.appendChild(el('option', { value: i, selected: i === GState.qIdx },
      'Q' + (i + 1) + ': ' + (wq.label || 'written') + '  (' + done + '/' + total + ' graded)'));
  });
  GState.qIdx = Q.clamp(GState.qIdx, 0, t.written.length - 1);
  GState.list = buildGradeList(GState.qIdx);
  GState.pos = Q.clamp(GState.pos, 0, Math.max(0, GState.list.length - 1));
  showGradeItem();
}

function showGradeItem() {
  var t = State.test;
  if (!t || !t.written.length) return;
  var wq = t.written[GState.qIdx];
  var item = GState.list[GState.pos];
  var img = $('#gradeImage');
  $('#gradeProgress').textContent = GState.list.length
    ? (GState.pos + 1) + ' of ' + GState.list.length : 'nothing scanned yet';

  if (!item) {
    img.removeAttribute('src');
    $('#gradeStudent').textContent = '';
    $('#pointsRow').innerHTML = '';
    return;
  }
  $('#gradeStudent').textContent = $('#gradeHideName').checked ? 'hidden' : item.name;

  if (item.blobId) {
    Q.DB.get('blobs', item.blobId).then(function (b) {
      if (b) img.src = b.data; else img.removeAttribute('src');
    });
  } else {
    img.removeAttribute('src');
  }

  var g = State.grades[item.sid] || {};
  var rec = (g.w || {})[GState.qIdx] || {};
  $('#gradeComment').value = rec.c || '';

  var max = wq.max || 0;
  var row = $('#pointsRow');
  row.innerHTML = '';
  var steps = [];
  if (max <= 10) { for (var v = 0; v <= max; v += (max <= 5 ? 0.5 : 1)) steps.push(v); }
  else { for (var v2 = 0; v2 <= max; v2 += Math.ceil(max / 10)) steps.push(v2); if (steps[steps.length - 1] !== max) steps.push(max); }
  steps.forEach(function (v) {
    row.appendChild(el('button', {
      class: 'pbtn' + (v === 0 ? ' zero' : '') + (rec.p === v ? ' on' : ''),
      text: String(v),
      onclick: function () { setPoints(v, true); }
    }));
  });
  row.appendChild(el('button', { class: 'pbtn', text: 'skip', title: 'Leave ungraded and move on',
    onclick: function () { move(1); } }));
  row.appendChild(el('input', {
    type: 'number', step: '0.5', min: '0', max: String(max), placeholder: '/' + max,
    style: 'width:82px', value: rec.p == null ? '' : rec.p,
    onchange: function (e) { setPoints(Math.min(max, +e.target.value || 0), false); }
  }));

  var qc = $('#quickComments');
  qc.innerHTML = '';
  (Q.Prefs.get('quickComments', ['Good work', 'Show your work', 'Incomplete', 'Off topic', 'Nearly — see key'])
    .concat(['+ add'])).forEach(function (c) {
      qc.appendChild(el('button', {
        class: 'qc', text: c,
        onclick: function () {
          if (c === '+ add') {
            Q.promptBox('Add a quick comment').then(function (v) {
              if (!v) return;
              var list = Q.Prefs.get('quickComments', []);
              list.push(v); Q.Prefs.set('quickComments', list); showGradeItem();
            });
            return;
          }
          var inp = $('#gradeComment');
          inp.value = inp.value ? inp.value + ' ' + c : c;
          inp.focus();
        }
      }));
    });
}

function setPoints(p, advance) {
  var item = GState.list[GState.pos];
  if (!item) return;
  var g = State.grades[item.sid] || (State.grades[item.sid] = {});
  g.w = g.w || {};
  g.w[GState.qIdx] = { p: p, c: $('#gradeComment').value.trim() };
  saveGrades().then(function () {
    recompute();
    if (advance) move(1); else showGradeItem();
  });
}
function move(d) {
  var item = GState.list[GState.pos];
  if (item && d > 0) {
    /* keep any comment typed even if no score was clicked */
    var c = $('#gradeComment').value.trim();
    var g = State.grades[item.sid];
    if (c && g && g.w && g.w[GState.qIdx]) { g.w[GState.qIdx].c = c; saveGrades(); }
  }
  var next = GState.pos + d;
  if (next < 0) next = 0;
  if (next >= GState.list.length) {
    if (d > 0) {
      var t = State.test;
      if (GState.qIdx < t.written.length - 1) {
        GState.qIdx++; GState.pos = 0;
        Q.Audio2.done();
        Q.toast('On to question ' + (GState.qIdx + 1) + '.', 'good');
        renderWrittenGrading();
        return;
      }
      Q.Audio2.done();
      Q.toast('All written questions graded.', 'good', 5000);
      next = GState.list.length - 1;
    }
  }
  GState.pos = next;
  $('#gradeQ').value = GState.qIdx;
  showGradeItem();
  updateBadges();
}

function gradeKeys(e) {
  if (!$('#view-written').classList.contains('active')) return;
  var tag = (e.target.tagName || '').toLowerCase();
  var inComment = e.target.id === 'gradeComment';
  if (tag === 'input' && !inComment) return;
  if (tag === 'select' || tag === 'textarea') return;

  var t = State.test;
  if (!t || !t.written.length) return;
  var max = t.written[GState.qIdx].max || 0;

  if (e.key === 'Enter') { e.preventDefault(); move(1); return; }
  if (inComment) return;                       // let the comment field take everything else
  if (e.key === ' ') { e.preventDefault(); move(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); move(1); return; }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setPoints(max, true); return; }
  if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); setPoints(0, true); return; }
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); move(1); return; }
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    var now = Date.now();
    GState.digitBuf = (now - GState.digitAt < 800) ? GState.digitBuf + e.key : e.key;
    GState.digitAt = now;
    var v = Math.min(max, parseFloat(GState.digitBuf));
    /* a single digit that cannot be extended scores immediately */
    var canExtend = max >= 10 && parseFloat(GState.digitBuf + '0') <= max;
    setPoints(v, !canExtend);
    if (canExtend) showGradeItem();
    return;
  }
  if (e.key === '.') {
    e.preventDefault();
    var cur = ((State.grades[(GState.list[GState.pos] || {}).sid] || {}).w || {})[GState.qIdx];
    var base = cur && typeof cur.p === 'number' ? Math.floor(cur.p) : 0;
    setPoints(Math.min(max, base + 0.5), true);
  }
}

/* ============================================================= EXPORT */
function fileBase() {
  var t = State.test;
  return (t.title || 'test').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 50) +
    '_' + (t.className || '').replace(/[^\w\-]+/g, '') + '_' + (t.date || Q.todayISO());
}

function gradebookRows() {
  var t = State.test, r = State.results;
  var head = ['Student', 'Student ID', 'Class', 'Total', 'Points possible', 'Percent', 'Letter',
              'MC correct', 'MC points', 'Written points', 'Pages scanned', 'Issues'];
  for (var i = 0; i < t.mc.count; i++) head.push('Q' + (i + 1));
  (t.written || []).forEach(function (w, i) { head.push('W' + (i + 1) + ' (' + (w.max || 0) + ')'); });

  var rows = [head];
  r.rows.forEach(function (x) {
    var issues = [];
    if (!x.scanned) issues.push('not scanned');
    if (x.missing.length) issues.push('missing p' + x.missing.join('/p'));
    if (x.multi) issues.push(x.multi + ' double-marked');
    if (x.blank) issues.push(x.blank + ' blank');
    var row = [
      x.name, x.sid, (State.byId[x.sid] || {}).cls || t.className || '',
      x.scanned ? x.total : null, x.max,
      x.scanned ? { v: x.pct, s: X.XS.PCT } : null,
      x.scanned ? x.letter : '',
      x.scanned ? x.correct : null, x.scanned ? x.mcPts : null, x.scanned ? x.wPts : null,
      x.pagesSeen.join(' ') || '', issues.join('; ')
    ];
    for (var i2 = 0; i2 < t.mc.count; i2++) {
      var a = x.answers[i2];
      row.push(a === -3 ? '' : x.states[i2] === 'multi' ? '**' : a < 0 ? '-' : S.LETTERS[a]);
    }
    (t.written || []).forEach(function (w, wi) {
      var rec = (x.wRecords || {})[wi];
      row.push(rec && typeof rec.p === 'number' ? rec.p : null);
    });
    return rows.push(row);
  });
  return rows;
}

function keyRow() {
  var t = State.test;
  var row = ['ANSWER KEY', '', '', '', '', '', '', '', '', '', '', ''];
  for (var i = 0; i < t.mc.count; i++) row.push(t.mc.key[i] == null ? '?' : S.LETTERS[t.mc.key[i]]);
  (t.written || []).forEach(function (w) { row.push(w.max || 0); });
  return row;
}

function exportGradebookXlsx() {
  var t = State.test, r = State.results;
  var rows = gradebookRows();
  rows.splice(1, 0, keyRow());
  rows[0] = rows[0].map(function (h) { return { v: h, s: X.XS.HEADER }; });
  rows[1] = rows[1].map(function (v) { return { v: v, s: X.XS.FLAG }; });

  var widths = [26, 12, 14, 9, 15, 10, 8, 11, 11, 14, 14, 26];
  for (var i = 0; i < t.mc.count + t.written.length; i++) widths.push(6.5);

  var summary = [
    [{ v: 'Test', s: X.XS.BOLD }, t.title || ''],
    [{ v: 'Class', s: X.XS.BOLD }, t.className || ''],
    [{ v: 'Date', s: X.XS.BOLD }, t.date || ''],
    [{ v: 'Test code', s: X.XS.BOLD }, t.code],
    [{ v: 'MC questions', s: X.XS.BOLD }, t.mc.count],
    [{ v: 'Points per MC', s: X.XS.BOLD }, t.mc.points],
    [{ v: 'Written questions', s: X.XS.BOLD }, t.written.length],
    [{ v: 'Points possible', s: X.XS.BOLD }, t.mc.count * t.mc.points +
      t.written.reduce(function (a, w) { return a + (w.max || 0); }, 0)],
    [],
    [{ v: 'Students scanned', s: X.XS.BOLD }, r.scannedRows.length],
    [{ v: 'Class average', s: X.XS.BOLD }, { v: r.avg, s: X.XS.PCT }],
    [{ v: 'Unmatched sheets', s: X.XS.BOLD }, r.unresolved.length],
    [],
    [{ v: 'Grading scale', s: X.XS.BOLD }],
    [{ v: 'Minimum %', s: X.XS.HEADER }, { v: 'Letter', s: X.XS.HEADER }]
  ].concat((t.options.scale || DEFAULT_SCALE).map(function (s) { return [s[0], s[1]]; }));

  var blob = X.buildXlsx([
    { name: 'Gradebook', rows: rows, cols: widths, freezeHeader: true, autoFilter: true },
    { name: 'Summary', rows: summary, cols: [22, 30] }
  ]);
  Q.downloadBlob(blob, fileBase() + '_gradebook.xlsx');
  Q.toast('Excel gradebook saved. It also imports cleanly into Google Sheets.', 'good', 5000);
}

function exportItemAnalysisXlsx() {
  var t = State.test, r = State.results;
  var head = ['Question', 'Correct answer', 'Class % correct', 'Answered', 'Got it right',
              'Blank', 'Double-marked'];
  for (var k = 0; k < t.mc.choices; k++) head.push('Chose ' + S.LETTERS[k]);
  head.push('Flag');
  var rows = [head.map(function (h) { return { v: h, s: X.XS.HEADER }; })];
  r.itemPct.forEach(function (it, i) {
    var flag = it.n === 0 ? '' : it.pct < 0.35 ? 'Hard — reteach?' : it.pct > 0.97 ? 'Everyone got it' : '';
    var row = [i + 1, t.mc.key[i] == null ? '?' : S.LETTERS[t.mc.key[i]],
      { v: it.pct, s: X.XS.PCT }, it.n, it.correct, it.blank, it.multi];
    it.dist.forEach(function (d) { row.push(d); });
    row.push(flag);
    rows.push(row);
  });

  var responses = [['Student', 'Student ID'].concat(
    Array.apply(null, Array(t.mc.count)).map(function (_, i) { return 'Q' + (i + 1); })
  ).map(function (h) { return { v: h, s: X.XS.HEADER }; })];
  r.rows.forEach(function (x) {
    if (!x.scanned) return;
    var row = [x.name, x.sid];
    for (var i = 0; i < t.mc.count; i++) {
      var a = x.answers[i];
      row.push(a === -3 ? '' : x.states[i] === 'multi' ? '**' : a < 0 ? '-' : S.LETTERS[a]);
    }
    responses.push(row);
  });

  var written = [['Student', 'Student ID', 'Question', 'Points', 'Max', 'Teacher note']
    .map(function (h) { return { v: h, s: X.XS.HEADER }; })];
  r.rows.forEach(function (x) {
    (t.written || []).forEach(function (wq, wi) {
      var rec = (x.wRecords || {})[wi];
      written.push([x.name, x.sid, wq.label || ('W' + (wi + 1)),
        rec && typeof rec.p === 'number' ? rec.p : null, wq.max || 0, (rec && rec.c) || '']);
    });
  });

  var sheets = [
    { name: 'Item analysis', rows: rows, cols: [10, 14, 14, 11, 13, 8, 15], freezeHeader: true },
    { name: 'Raw responses', rows: responses, cols: [26, 12], freezeHeader: true, autoFilter: true }
  ];
  if (t.written.length) sheets.push({ name: 'Written answers', rows: written, cols: [26, 12, 28, 9, 8, 46], freezeHeader: true });

  Q.downloadBlob(X.buildXlsx(sheets), fileBase() + '_item_analysis.xlsx');
  Q.toast('Item analysis saved.', 'good');
}

/* --------------------------------------------------------- top sheets */
function topSheetBody(x, opts) {
  var t = State.test, r = State.results, ts = t.options.topsheet;
  var P = X.p, T = X.table;
  var out = '';

  out += P(x.name || 'Unknown student', { style: 'Heading1' });
  var sub = [t.title || 'Test'];
  if (t.className) sub.push(t.className);
  if (ts.showDate && t.date) sub.push(Q.prettyDate(t.date));
  if (ts.showStudentId && x.sid) sub.push('ID ' + x.sid);
  out += P(sub.join('   ·   '), { size: 9, color: '5B6577', spaceAfter: 160 });

  if (ts.showScoreBand) {
    var band = [[
      { text: 'SCORE', b: true, align: 'center', size: 8 },
      ts.showPercent ? { text: 'PERCENT', b: true, align: 'center', size: 8 } : null,
      ts.showLetter ? { text: 'GRADE', b: true, align: 'center', size: 8 } : null,
      { text: 'MULTIPLE CHOICE', b: true, align: 'center', size: 8 },
      t.written.length ? { text: 'WRITTEN', b: true, align: 'center', size: 8 } : null
    ].filter(Boolean), [
      { text: x.total + ' / ' + x.max, align: 'center', b: true, size: 16 },
      ts.showPercent ? { text: Math.round(x.pct * 100) + '%', align: 'center', b: true, size: 16 } : null,
      ts.showLetter ? { text: x.letter, align: 'center', b: true, size: 16 } : null,
      { text: x.correct + ' / ' + t.mc.count + ' correct', align: 'center', size: 11 },
      t.written.length ? { text: x.wPts + ' / ' + x.wMax, align: 'center', size: 11 } : null
    ].filter(Boolean)];
    out += T(band, { header: false });
  }

  var extra = [];
  if (ts.showClassAvg) extra.push('Class average: ' + Math.round(r.avg * 100) + '%');
  if (ts.showRank && x.rank) extra.push('Rank: ' + x.rank + ' of ' + r.scannedRows.length);
  if (x.missing.length) extra.push('⚠ Page(s) not scanned: ' + x.missing.join(', '));
  if (x.multi) extra.push('⚠ ' + x.multi + ' question(s) had more than one bubble filled and scored as incorrect');
  if (extra.length) out += P(extra.join('    ·    '), { size: 9, color: '8A5A00', spaceAfter: 140 });

  if (ts.showMissedList && t.mc.count) {
    var missed = [];
    for (var i = 0; i < t.mc.count; i++) {
      if (x.answers[i] === -3) continue;
      if (t.mc.key[i] == null) continue;
      if (x.answers[i] !== t.mc.key[i]) missed.push(i + 1);
    }
    out += P('Questions missed: ' + (missed.length ? missed.join(', ') : 'none — perfect on multiple choice'),
      { size: 10, b: true, spaceAfter: 140 });
  }

  if (ts.showMc && t.mc.count) {
    out += P('Multiple choice', { style: 'Heading2' });
    var head = [{ text: '#' }, { text: 'Your answer' }, { text: 'Correct' }, { text: 'Result' }, { text: 'Pts' }];
    var widths = [0.07, 0.16, 0.13, 0.14, 0.10];
    if (ts.showQuestionText) { head.splice(1, 0, { text: 'Question' }); widths = [0.05, 0.40, 0.12, 0.10, 0.11, 0.08]; }
    if (ts.showTopic) { head.push({ text: 'Topic' }); widths.push(0.16); }
    if (ts.showClassPct) { head.push({ text: 'Class' }); widths.push(0.10); }
    var sum = widths.reduce(function (a, b) { return a + b; }, 0);
    widths = widths.map(function (w) { return w / sum; });

    var body = [head];
    for (var qi = 0; qi < t.mc.count; qi++) {
      var a = x.answers[qi], key = t.mc.key[qi];
      var isRight = key != null && a === key;
      if (ts.onlyWrong && isRight) continue;
      if (a === -3 && ts.onlyWrong) continue;
      var yours = a === -3 ? '—' : x.states[qi] === 'multi' ? 'two marks' : a < 0 ? 'blank' : S.LETTERS[a];
      var row = [{ text: String(qi + 1), align: 'center' }];
      if (ts.showQuestionText) row.push({ text: (t.mc.text || [])[qi] || '', size: 9 });
      row.push({ text: yours, align: 'center', b: !isRight, color: isRight ? '1A7F4B' : 'B3261E' });
      row.push({ text: key == null ? '?' : S.LETTERS[key], align: 'center' });
      row.push({ text: a === -3 ? 'not scanned' : isRight ? '✓ correct' : '✗ incorrect', align: 'center',
                 color: isRight ? '1A7F4B' : 'B3261E' });
      row.push({ text: String(isRight ? t.mc.points : 0), align: 'center' });
      if (ts.showTopic) row.push({ text: (t.mc.topic || [])[qi] || '', size: 9 });
      if (ts.showClassPct) row.push({ text: Math.round((r.itemPct[qi] || {}).pct * 100) + '%', align: 'center', size: 9 });
      body.push(row);
    }
    if (body.length === 1) body.push([{ text: 'Every multiple-choice question was correct.', colspan: head.length }]);
    out += T(body, { header: true, widths: widths });
  }

  if (ts.showWritten && t.written.length) {
    out += P('Written answers', { style: 'Heading2' });
    var wh = [{ text: '#' }, { text: 'Question' }, { text: 'Points' }];
    var ww = [0.07, 0.58, 0.13];
    if (ts.showWrittenNotes) { wh.push({ text: 'Comment' }); ww = [0.06, 0.40, 0.12, 0.42]; }
    var wsum = ww.reduce(function (a, b) { return a + b; }, 0);
    ww = ww.map(function (w) { return w / wsum; });
    var wbody = [wh];
    t.written.forEach(function (wq, wi) {
      var rec = (x.wRecords || {})[wi] || {};
      var row = [
        { text: String(wi + 1), align: 'center' },
        { text: wq.label || ('Written question ' + (wi + 1)), size: 10 },
        { text: (typeof rec.p === 'number' ? rec.p : '—') + ' / ' + (wq.max || 0), align: 'center', b: true }
      ];
      if (ts.showWrittenNotes) row.push({ text: rec.c || '', size: 9 });
      wbody.push(row);
    });
    out += T(wbody, { header: true, widths: ww });
    if (t.written.some(function (w) { return w.expected; })) {
      out += P('Expected answers', { style: 'Heading2' });
      t.written.forEach(function (wq, wi) {
        if (wq.expected) out += P((wi + 1) + '. ' + wq.expected, { size: 10 });
      });
    }
  }

  if (ts.commentBox) {
    out += P('Teacher comments', { style: 'Heading2' });
    if (x.comment) out += P(x.comment, { size: 11, spaceAfter: 60 });
    var lines = ts.commentLines ? 4 : 3;
    var blank = new Array(lines).join('\n') + '\n';
    out += P(blank, { borderBox: true, size: 11 });
  }

  var sigs = [];
  if (ts.sigTeacher) sigs.push('Teacher');
  if (ts.sigParent) sigs.push('Parent / guardian');
  if (ts.sigStudent) sigs.push('Student — corrections requested');
  if (sigs.length) {
    var cells = sigs.map(function (label) {
      return { xml: X.p('', { borderBottom: true, spaceBefore: 260, spaceAfter: 0 }) +
                    X.p(label + '                              Date', { size: 8, color: '6B7280' }) };
    });
    out += X.table([cells], { borders: false, widths: sigs.map(function () { return 1 / sigs.length; }) });
  }

  if (t.options.footer) out += P(t.options.footer, { size: 9, color: '6B7280', spaceBefore: 120 });
  return out;
}

function exportTopSheetsDocx() {
  var t = State.test, r = State.results;
  var rows = r.rows.filter(function (x) { return x.scanned; });
  if (!rows.length) { Q.toast('No scanned students yet.', 'err'); return; }
  var body = '';
  rows.forEach(function (x, i) {
    if (i) body += t.options.topsheet.pageBreakEach ? X.pageBreak() : X.emptyP(14);
    body += topSheetBody(x);
  });
  Q.downloadBlob(X.buildDocx(body), fileBase() + '_top_sheets.docx');
  Q.toast('Word file saved — ' + rows.length + ' top sheet(s). Opens in Word and in Google Docs.', 'good', 6000);
}

function printTopSheets() {
  var t = State.test, r = State.results, ts = t.options.topsheet;
  var rows = r.rows.filter(function (x) { return x.scanned; });
  if (!rows.length) { Q.toast('No scanned students yet.', 'err'); return; }
  var css = '@page{size:letter;margin:.6in}' +
    'body{font:12px/1.45 Calibri,Arial,sans-serif;color:#111;margin:0}' +
    '.sh{page-break-after:always}.sh:last-child{page-break-after:auto}' +
    'h1{font-size:21px;margin:0 0 2px}.sub{color:#5b6577;font-size:11px;margin-bottom:10px}' +
    'h2{font-size:13px;color:#2f5597;margin:16px 0 5px;border-bottom:1px solid #d8dee9;padding-bottom:2px}' +
    'table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}' +
    'th,td{border:1px solid #b0b7c3;padding:3px 5px}th{background:#e9eef6;text-align:left}' +
    '.c{text-align:center}.ok{color:#1a7f4b}.no{color:#b3261e;font-weight:700}' +
    '.band td{text-align:center;font-size:17px;font-weight:700}.band th{text-align:center;font-size:9px}' +
    '.cbox{border:1px solid #999;height:.95in;border-radius:3px}' +
    '.sig{display:flex;gap:26px;margin-top:26px}.sig div{flex:1;border-top:1px solid #333;' +
    'padding-top:3px;font-size:9px;color:#6b7280}' +
    '.toolbar{background:#111;color:#fff;padding:10px 14px;display:flex;gap:12px;align-items:center}' +
    '.toolbar button{background:#22c07a;color:#04240f;border:0;border-radius:7px;padding:9px 16px;' +
    'font:inherit;font-weight:700;cursor:pointer}' +
    '@media print{.toolbar{display:none}}';

  var h = '<!doctype html><html><head><meta charset="utf-8"><title>' + X.xml(t.title) +
    ' — graded top sheets</title><style>' + css + '</style></head><body>' +
    '<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button>' +
    '<span>' + rows.length + ' student sheet(s)</span></div>';

  rows.forEach(function (x) {
    h += '<div class="sh"><h1>' + X.xml(x.name) + '</h1><div class="sub">' +
      [X.xml(t.title), X.xml(t.className), ts.showDate ? Q.prettyDate(t.date) : '',
       ts.showStudentId ? 'ID ' + x.sid : ''].filter(Boolean).join(' &nbsp;·&nbsp; ') + '</div>';
    if (ts.showScoreBand) {
      h += '<table class="band"><tr><th>SCORE</th>' + (ts.showPercent ? '<th>PERCENT</th>' : '') +
        (ts.showLetter ? '<th>GRADE</th>' : '') + '<th>MULTIPLE CHOICE</th>' +
        (t.written.length ? '<th>WRITTEN</th>' : '') + '</tr><tr><td>' + x.total + ' / ' + x.max + '</td>' +
        (ts.showPercent ? '<td>' + Math.round(x.pct * 100) + '%</td>' : '') +
        (ts.showLetter ? '<td>' + x.letter + '</td>' : '') +
        '<td>' + x.correct + ' / ' + t.mc.count + '</td>' +
        (t.written.length ? '<td>' + x.wPts + ' / ' + x.wMax + '</td>' : '') + '</tr></table>';
    }
    if (ts.showMc && t.mc.count) {
      h += '<h2>Multiple choice</h2><table><tr><th class="c">#</th>' +
        (ts.showQuestionText ? '<th>Question</th>' : '') +
        '<th class="c">Your answer</th><th class="c">Correct</th><th class="c">Result</th><th class="c">Pts</th>' +
        (ts.showTopic ? '<th>Topic</th>' : '') + (ts.showClassPct ? '<th class="c">Class</th>' : '') + '</tr>';
      for (var i = 0; i < t.mc.count; i++) {
        var a = x.answers[i], key = t.mc.key[i], right = key != null && a === key;
        if (ts.onlyWrong && (right || a === -3)) continue;
        var yours = a === -3 ? '—' : x.states[i] === 'multi' ? 'two marks' : a < 0 ? 'blank' : S.LETTERS[a];
        h += '<tr><td class="c">' + (i + 1) + '</td>' +
          (ts.showQuestionText ? '<td>' + X.xml((t.mc.text || [])[i] || '') + '</td>' : '') +
          '<td class="c ' + (right ? 'ok' : 'no') + '">' + yours + '</td>' +
          '<td class="c">' + (key == null ? '?' : S.LETTERS[key]) + '</td>' +
          '<td class="c ' + (right ? 'ok' : 'no') + '">' + (a === -3 ? 'not scanned' : right ? '✓ correct' : '✗ incorrect') + '</td>' +
          '<td class="c">' + (right ? t.mc.points : 0) + '</td>' +
          (ts.showTopic ? '<td>' + X.xml((t.mc.topic || [])[i] || '') + '</td>' : '') +
          (ts.showClassPct ? '<td class="c">' + Math.round((r.itemPct[i] || {}).pct * 100) + '%</td>' : '') +
          '</tr>';
      }
      h += '</table>';
    }
    if (ts.showWritten && t.written.length) {
      h += '<h2>Written answers</h2><table><tr><th class="c">#</th><th>Question</th><th class="c">Points</th>' +
        (ts.showWrittenNotes ? '<th>Comment</th>' : '') + '</tr>';
      t.written.forEach(function (wq, wi) {
        var rec = (x.wRecords || {})[wi] || {};
        h += '<tr><td class="c">' + (wi + 1) + '</td><td>' + X.xml(wq.label || '') + '</td>' +
          '<td class="c"><b>' + (typeof rec.p === 'number' ? rec.p : '—') + ' / ' + (wq.max || 0) + '</b></td>' +
          (ts.showWrittenNotes ? '<td>' + X.xml(rec.c || '') + '</td>' : '') + '</tr>';
      });
      h += '</table>';
    }
    if (ts.commentBox) h += '<h2>Teacher comments</h2>' +
      (x.comment ? '<p>' + X.xml(x.comment) + '</p>' : '') + '<div class="cbox"></div>';
    var sig = [];
    if (ts.sigTeacher) sig.push('Teacher &nbsp;&nbsp;&nbsp; Date');
    if (ts.sigParent) sig.push('Parent / guardian &nbsp;&nbsp;&nbsp; Date');
    if (ts.sigStudent) sig.push('Student — corrections requested');
    if (sig.length) h += '<div class="sig">' + sig.map(function (s) { return '<div>' + s + '</div>'; }).join('') + '</div>';
    if (t.options.footer) h += '<p style="font-size:9px;color:#6b7280;margin-top:14px">' + X.xml(t.options.footer) + '</p>';
    h += '</div>';
  });
  Q.openPrintWindow(h + '</body></html>', false);
}

function renderExport() {
  recompute();
  if (!State.test) return;
  renderTopsheetOpts($('#topsheetOpts2'), State.test);
  var box = $('#scaleEditor');
  box.innerHTML = '';
  var scale = State.test.options.scale;
  scale.forEach(function (row, i) {
    box.appendChild(el('span', { class: 'row gap' }, [
      el('input', { type: 'number', value: row[0], style: 'width:70px',
        onchange: function (e) { row[0] = +e.target.value || 0; saveTest().then(recompute); } }),
      el('span', { class: 'hint', text: '% →' }),
      el('input', { value: row[1], style: 'width:60px',
        onchange: function (e) { row[1] = e.target.value; saveTest().then(recompute); } }),
      el('button', { class: 'btn sm danger', text: '×',
        onclick: function () { scale.splice(i, 1); saveTest().then(function () { recompute(); renderExport(); }); } })
    ]));
  });
  box.appendChild(el('button', { class: 'btn sm', text: '+ band',
    onclick: function () { scale.push([50, 'F']); saveTest().then(function () { recompute(); renderExport(); }); } }));
}

/* ============================================================= backup */
function exportBackup(scopeTest) {
  var payload = {
    app: 'quickgrade', version: 1, exportedAt: new Date().toISOString(),
    tests: scopeTest ? [State.test] : State.tests,
    students: State.students,
    grades: {}, scans: []
  };
  var ids = payload.tests.map(function (t) { return t.id; });
  return Promise.all([Q.DB.all('scans'), Q.DB.all('kv')]).then(function (r) {
    payload.scans = (r[0] || []).filter(function (s) { return ids.indexOf(s.testId) >= 0; })
      .map(function (s) { var c = Object.assign({}, s); delete c.thumb; return c; });
    (r[1] || []).forEach(function (kv) {
      if (/^grades:/.test(kv.k) && ids.indexOf(kv.k.slice(7)) >= 0) payload.grades[kv.k] = kv.v;
    });
    Q.downloadText(JSON.stringify(payload, null, 1),
      (scopeTest ? fileBase() : 'quickgrade_all') + '_backup.json', 'application/json');
    Q.toast('Backup saved. Scanned images are not included (they stay on this device).', 'good', 6000);
  });
}
function importBackup(file) {
  return Q.readFileText(file).then(function (txt) {
    var d = JSON.parse(txt);
    if (d.app !== 'quickgrade') throw new Error('Not a QuickGrade backup file');
    var jobs = [];
    if (d.tests && d.tests.length) jobs.push(Q.DB.putMany('tests', d.tests.map(normalizeTest)));
    if (d.students && d.students.length) jobs.push(Q.DB.putMany('students', d.students));
    if (d.scans && d.scans.length) jobs.push(Q.DB.putMany('scans', d.scans));
    Object.keys(d.grades || {}).forEach(function (k) { jobs.push(Q.DB.put('kv', { k: k, v: d.grades[k] })); });
    return Promise.all(jobs);
  }).then(function () {
    Q.toast('Backup imported. Reloading…', 'good');
    setTimeout(function () { location.reload(); }, 900);
  }).catch(function (e) { Q.toast('Import failed: ' + e.message, 'err', 6000); });
}

/* =============================================================== wire */
function wireUI() {
  $$('.navbtn').forEach(function (b) { on(b, 'click', function () { Q.Audio2.unlock(); route(b.dataset.view); }); });
  on($('#brandBtn'), 'click', function () { route('tests'); });

  /* tests */
  on($('#btnNewTest'), 'click', function () { openEditor(null); });
  on($('#btnCancelTest'), 'click', closeEditor);
  on($('#btnKeyClear'), 'click', function () { editing.mc.key = []; renderKeyGrid(); });
  on($('#btnAddWritten'), 'click', function () {
    editing.written.push({ label: '', max: 5, kind: 'short', expected: '' });
    renderWrittenList();
  });
  ['#f_mcCount', '#f_choices'].forEach(function (sel) {
    on($(sel), 'change', function () {
      editing.mc.count = Q.clamp(parseInt($('#f_mcCount').value, 10) || 0, 0, 300);
      editing.mc.choices = parseInt($('#f_choices').value, 10) || 5;
      editing.mc.key = editing.mc.key.map(function (k) {
        return k != null && k < editing.mc.choices ? k : null;
      });
      renderKeyGrid();
    });
  });
  on($('#btnKeyFromScan'), 'click', function () {
    Q.modal('<h3>Capture the key by scanning</h3>' +
      '<p>Print the <b>answer-key sheet</b> from the Roster tab (it is pre-bubbled with ID 999999), ' +
      'or bubble a blank sheet with ID <b>999999</b> and the correct answers.</p>' +
      '<p>Scan it like any other sheet — QuickGrade recognises 999999 as the key and fills this grid in.</p>' +
      '<p class="hint">Save this test first so the sheet carries the right test code.</p>');
  });
  on($('#btnSaveTest'), 'click', function () {
    collectEditor();
    if (!editing.title) { Q.toast('Give the test a title.', 'err'); return; }
    var dupCode = State.tests.filter(function (t) { return t.code === editing.code && t.id !== editing.id; });
    if (dupCode.length) {
      Q.toast('Warning: test code ' + editing.code + ' is already used by "' + dupCode[0].title +
        '". Sheets could be scanned into the wrong test.', 'err', 8000);
    }
    Q.DB.put('tests', editing).then(function () {
      var i = State.tests.findIndex(function (t) { return t.id === editing.id; });
      if (i >= 0) State.tests[i] = editing; else State.tests.unshift(editing);
      return selectTest(editing);
    }).then(function () {
      closeEditor(); renderTests(); renderRosterView();
      Q.toast('Saved.', 'good');
    });
  });
  on($('#btnDeleteTest'), 'click', function () {
    Q.confirmBox('Delete "' + (editing.title || 'this test') + '" and all of its scans?').then(function (ok) {
      if (!ok) return;
      var id = editing.id;
      Q.DB.all('scans').then(function (all) {
        var mine = all.filter(function (s) { return s.testId === id; });
        var blobIds = [];
        mine.forEach(function (s) { blobIds = blobIds.concat(collectBlobIds(s)); });
        return Promise.all([
          Q.DB.delMany('scans', mine.map(function (s) { return s.id; })),
          blobIds.length ? Q.DB.delMany('blobs', blobIds) : null,
          Q.DB.del('kv', 'grades:' + id),
          Q.DB.del('tests', id)
        ]);
      }).then(function () {
        State.tests = State.tests.filter(function (t) { return t.id !== id; });
        closeEditor();
        return selectTest(State.tests[0] || null);
      }).then(function () { renderTests(); Q.toast('Deleted.', 'good'); });
    });
  });
  on($('#btnExportBackup'), 'click', function () { exportBackup(false); });
  on($('#btnImportBackup'), 'click', function () { $('#backupInput').click(); });
  on($('#backupInput'), 'change', function (e) {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  /* roster */
  on($('#rosterClass'), 'change', renderRosterTable);
  on($('#btnNewClass'), 'click', function () {
    Q.promptBox('Name of the new class / period').then(function (v) {
      if (!v) return;
      var sel = $('#rosterClass');
      sel.appendChild(el('option', { value: v, selected: true }, v));
      sel.value = v;
      renderRosterTable();
    });
  });
  on($('#btnRosterSave'), 'click', saveRosterPaste);
  on($('#btnRosterClear'), 'click', function () {
    var cls = currentClass();
    Q.confirmBox('Remove every student in "' + cls + '"?').then(function (ok) {
      if (!ok) return;
      var ids = State.students.filter(function (s) { return s.cls === cls; }).map(function (s) { return s.sid; });
      Q.DB.delMany('students', ids).then(function () {
        State.students = State.students.filter(function (s) { return s.cls !== cls; });
        indexStudents(); renderRosterTable(); recompute();
      });
    });
  });
  on($('#btnRosterCsv'), 'click', function () {
    var cls = currentClass();
    var rows = [['Name', 'Student ID', 'Class']].concat(
      State.students.filter(function (s) { return s.cls === cls; })
        .sort(function (a, b) { return Q.sortName(a.name).localeCompare(Q.sortName(b.name)); })
        .map(function (s) { return [s.name, s.sid, s.cls]; }));
    Q.downloadText(X.toCsv(rows), 'roster_' + (cls || 'class').replace(/\W+/g, '_') + '.csv', 'text/csv');
  });
  on($('#btnPrintPersonal'), 'click', function () { printSheets('personal'); });
  on($('#btnPrintBlank'), 'click', function () { printSheets('blank'); });
  on($('#btnPrintKey'), 'click', function () { printSheets('key'); });

  /* scan */
  on($('#btnCamStart'), 'click', function () {
    Q.Audio2.unlock();
    Scanner.start($('#camSelect').value || undefined);
  });
  on($('#camSelect'), 'change', function (e) { if (Scanner.running) Scanner.start(e.target.value); });
  on($('#btnTorch'), 'click', function () { Scanner.toggleTorch(); });
  on($('#optSound'), 'change', function (e) { Q.Audio2.setEnabled(e.target.checked); Q.Prefs.set('sound', e.target.checked); });
  on($('#optSpeak'), 'change', function (e) { Q.Prefs.set('speak', e.target.checked); });
  $('#optSound').checked = Q.Prefs.get('sound', true);
  $('#optSpeak').checked = Q.Prefs.get('speak', false);
  Q.Audio2.setEnabled($('#optSound').checked);
  on($('#btnPhotoImport'), 'click', function () { $('#photoInput').click(); });
  on($('#photoInput'), 'change', function (e) {
    if (e.target.files && e.target.files.length) Scanner.importFiles(e.target.files);
    e.target.value = '';
  });

  /* review */
  on($('#showMissingOnly'), 'change', renderReview);
  on($('#btnClearScans'), 'click', function () {
    Q.confirmBox('Delete every scan for "' + State.test.title + '"? Grades you typed are kept.').then(function (ok) {
      if (!ok) return;
      var mine = State.scans.slice();
      var blobIds = [];
      mine.forEach(function (s) { blobIds = blobIds.concat(collectBlobIds(s)); });
      Promise.all([
        Q.DB.delMany('scans', mine.map(function (s) { return s.id; })),
        blobIds.length ? Q.DB.delMany('blobs', blobIds) : null
      ]).then(function () {
        State.scans = []; Scanner.resetSession(); recompute(); renderReview();
      });
    });
  });

  /* grading */
  on($('#gradeQ'), 'change', function (e) { GState.qIdx = +e.target.value; GState.pos = 0; renderWrittenGrading(); });
  on($('#btnGradePrev'), 'click', function () { move(-1); });
  on($('#btnGradeNext'), 'click', function () { move(1); });
  on($('#gradeHideName'), 'change', showGradeItem);
  on($('#gradeImage'), 'click', function (e) { e.target.classList.toggle('zoom'); });
  document.addEventListener('keydown', gradeKeys);

  /* export */
  on($('#exXlsx'), 'click', function () { recompute(); exportGradebookXlsx(); });
  on($('#exCsv'), 'click', function () {
    recompute();
    var rows = gradebookRows(); rows.splice(1, 0, keyRow());
    Q.downloadText(X.toCsv(rows), fileBase() + '_gradebook.csv', 'text/csv');
    Q.toast('CSV saved — in Google Sheets use File ▸ Import ▸ Upload.', 'good', 6000);
  });
  on($('#exTsv'), 'click', function () {
    recompute();
    var rows = gradebookRows(); rows.splice(1, 0, keyRow());
    Q.copyToClipboard(X.toTsv(rows)).then(function () {
      Q.toast('Copied. Click cell A1 in Sheets or Excel and paste.', 'good', 6000);
    }).catch(function () { Q.toast('Clipboard blocked by the browser — use the CSV button.', 'err'); });
  });
  on($('#exDocx'), 'click', function () { recompute(); exportTopSheetsDocx(); });
  on($('#exPrintSheets'), 'click', function () { recompute(); printTopSheets(); });
  on($('#exRawXlsx'), 'click', function () { recompute(); exportItemAnalysisXlsx(); });
  on($('#exJson'), 'click', function () { exportBackup(true); });

  /* Stop the camera when the tab is hidden so the phone does not cook. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && Scanner.running) Scanner.stop();
  });
}

global.QG.App = { State: State, route: route, recompute: recompute, selectTest: selectTest };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})(window);
