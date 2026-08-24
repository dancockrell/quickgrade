/* QuickGrade — app.js : state, routing, editors, grading and exports. */
(function (global) {
'use strict';

var Q = global.QG, S = Q.Sheet, X = Q.OOXML, X2 = Q.ExportMap,
    SC = Q.Scoring, Scanner = Q.Scanner;
var $ = Q.$, $$ = Q.$$, el = Q.el, on = Q.on;

/* ================================================================ state */
var State = {
  tests: [], test: null, pages: [],
  students: [], byId: {},
  scans: [], trash: [], grades: {},
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
  { k: 'showMastery',     d: false, t: 'What this student has and hasn’t got' },
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
  var o = { prefillId: false, idDigits: 3, idLabel: '', paper: 'letter', labels: {},
           wPerPage: 2, instructions: '',
           scale: DEFAULT_SCALE.slice(), footer: '', topsheet: {} };
  TOPSHEET_OPTS.forEach(function (t) { o.topsheet[t.k] = t.d; });
  return o;
}
function newTest() {
  return {
    id: Q.uid('t'), title: '', className: '', classes: [], date: Q.todayISO(),
    code: String(Math.floor(Math.random() * 900) + 100),
    mc: { count: 20, choices: 5, key: [], points: 1, text: [], topic: [], rules: {} },
    curve: { kind: 'none', value: 0 },
    written: [], options: defaultOptions(), createdAt: Date.now()
  };
}
function normalizeTest(t) {
  /* A test is usually given to several periods. `classes` is the truth;
   * `className` is kept as the joined display string so older saved tests,
   * printed sheets and exports keep working. */
  t.classes = Array.isArray(t.classes)
    ? t.classes.map(function (c) { return String(c).trim(); }).filter(Boolean)
    : String(t.className || '').split(/\s*[,;]\s*/).map(function (c) { return c.trim(); }).filter(Boolean);
  t.className = t.classes.join(', ');
  t.mc = t.mc || {};
  t.mc.count = t.mc.count || 0;
  t.mc.choices = t.mc.choices || 5;
  t.mc.key = t.mc.key || [];
  t.mc.points = t.mc.points == null ? 1 : t.mc.points;
  t.mc.text = t.mc.text || [];
  t.mc.topic = t.mc.topic || [];
  t.mc.rules = t.mc.rules || {};
  t.forms = Array.isArray(t.forms) ? t.forms : [];
  t.formLabel = t.formLabel || 'A';
  t.curve = t.curve || { kind: 'none', value: 0 };
  t.written = t.written || [];
  /* Merge nested `topsheet` explicitly: a plain Object.assign would let a
   * stored `topsheet:{}` replace the whole defaults object and silently turn
   * every top-sheet section off. */
  var base = defaultOptions();
  var defTop = base.topsheet;
  var userTop = (t.options && t.options.topsheet) || {};
  t.options = Object.assign(base, t.options || {});
  t.options.topsheet = Object.assign({}, defTop, userTop);
  t.options.labels = Object.assign({}, (t.options && t.options.labels) || {});
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

/* Browsers may evict IndexedDB under storage pressure. Asking for persistence
 * makes a class set of grades far less likely to vanish on its own. */
function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (already) {
        if (!already) navigator.storage.persist();
      });
    }
  } catch (e) {}
}

/* Everything lives in this browser. Nag gently rather than lose a class set. */
function backupNudge() {
  if (!State.scans.length) return;
  if (Q.Prefs.get('sampleLoadedAt', 0) > Date.now() - 120000) return;
  var last = Q.Prefs.get('lastBackup', 0);
  var days = (Date.now() - last) / 86400000;
  if (last && days < 7) return;
  Q.toast(last
    ? 'Last backup was ' + Math.floor(days) + ' days ago. Tests ▸ Export backup keeps a copy off this browser.'
    : 'Reminder: this data lives only in this browser. Tests ▸ Export backup makes a portable copy.',
    'err', 9000);
}

function boot() {
  Q.DB.ready().then(storageBanner);
  requestPersistence();
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
    setTimeout(backupNudge, 2500);
  }).catch(function (e) {
    console.error(e);
    Q.toast('Startup problem: ' + e.message, 'err', 8000);
  });
}

function indexStudents() {
  State.byId = {};
  State.students.forEach(function (s) { State.byId[S.normId(s.sid)] = s; });
}

function selectTest(t) {
  State.test = t ? normalizeTest(t) : null;
  State.pages = t ? S.layoutTest(State.test) : [];
  Q.Prefs.set('testId', t ? t.id : null);
  updateCtx();
  if (!t) { State.scans = []; State.grades = {}; State.results = null; return Promise.resolve(); }
  return Promise.all([Q.DB.all('scans'), Q.DB.get('kv', 'grades:' + t.id)]).then(function (r) {
    var mine = (r[0] || []).filter(function (s) { return s.testId === t.id; });
    /* Deletions are reversible: a scan is marked, not destroyed, until the
     * teacher empties the trash or the whole test is deleted. */
    State.scans = mine.filter(function (s) { return !s.deleted; });
    State.trash = mine.filter(function (s) { return !!s.deleted; });
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
  if (name === 'review') { renderReview(); renderStorage(); }
  if (name === 'written') renderWrittenGrading();
  if (name === 'export') renderExport();
  if (name === 'scan') { Q.Audio2.unlock(); updateCtx(); }
}

/* ============================================================ results */
function studentName(sid) {
  var s = State.byId[S.normId(sid)];
  return s ? s.name : (sid ? 'ID ' + sid : 'Unknown');
}
function classStudents() {
  var t = State.test;
  if (!t) return [];
  var want = t.classes || [];
  var list = want.length
    ? State.students.filter(function (s) { return want.indexOf(s.cls || '') >= 0; })
    : [];
  if (!list.length) list = State.students.slice();
  /* group by class first when a test spans several periods, so printed
   * sheets and the gradebook come out in the order a teacher hands them back */
  return list.sort(function (a, b) {
    if (want.length > 1) {
      var d = want.indexOf(a.cls || '') - want.indexOf(b.cls || '');
      if (d) return d;
    }
    return Q.sortName(a.name).localeCompare(Q.sortName(b.name));
  });
}
/** True when this test is shared across more than one class. */
function multiClass() { return !!(State.test && (State.test.classes || []).length > 1); }

function recompute() {
  var t = State.test;
  if (!t) { State.results = null; return; }
  /* Cheap, and removes a whole class of bug: any path that replaces the
   * student list no longer has to remember to reindex. */
  indexStudents();
  var nPages = State.pages.length;
  var byStudent = {};

  State.scans.forEach(function (sc) {
    var key = S.normId(sc.sid);
    if (!key) return;
    var e = byStudent[key] || (byStudent[key] = { sid: key, scans: [], pages: {} });
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
        /* a mark the teacher corrected by eye always wins over the reader */
        Object.keys(sc.overrides || {}).forEach(function (k) {
          answers[+k] = sc.overrides[k];
          states[+k] = 'fixed';
        });
      });
    }
    pagesSeen.sort(function (a, b) { return a - b; });
    var missing = [];
    for (var p = 1; p <= nPages; p++) if (pagesSeen.indexOf(p) < 0) missing.push(p);

    var g = State.grades[sid] || {};
    /* every page a student hands in belongs to the same printed version */
    var formId = null;
    if (e) e.scans.forEach(function (s) { if (s.form) formId = s.form; });
    var variant = SC.variantOf(t, formId);
    var sc = SC.scoreStudent(t, answers, states, g.w || {}, variant);
    return {
      sid: sid, name: name || studentName(sid),
      form: variant.id, formPrimary: !!variant.primary,
      answers: answers, states: states, qStatus: sc.qStatus,
      pagesSeen: pagesSeen, missing: missing, scanned: pagesSeen.length > 0,
      correct: sc.correct, blank: sc.blank, multi: sc.multi, unscanned: sc.unscanned,
      credited: sc.credited, dropped: sc.dropped,
      mcPts: Q.round2(sc.mcEarned), mcMax: Q.round2(sc.mcPossible),
      wPts: Q.round2(sc.wEarned), wMax: Q.round2(sc.wPossible), wGraded: sc.wGraded,
      total: Q.round2(sc.total), max: Q.round2(sc.max),
      rawPct: sc.pct, pct: sc.pct,            /* pct is replaced by the curve pass below */
      letter: '',
      comment: g.comment || '', wRecords: g.w || {}
    };
  }

  roster.forEach(function (s) { seen[s.sid] = 1; rows.push(build(s.sid, s.name)); });
  Object.keys(byStudent).forEach(function (sid) {
    if (!seen[sid]) rows.push(build(sid, studentName(sid)));
  });

  /* A curve needs the whole class before any single score is final, so it is
   * applied here rather than inside the per-student pass. */
  var scannedRows = rows.filter(function (r) { return r.scanned; });
  var topPct = scannedRows.reduce(function (m, r) { return Math.max(m, r.rawPct); }, 0);
  rows.forEach(function (r) {
    r.pct = SC.curvedPct(t, r.rawPct, { topPct: topPct, max: r.max });
    r.curved = Math.abs(r.pct - r.rawPct) > 1e-9;
    r.total = Q.round2(r.curved ? r.pct * r.max : r.total);
    r.letter = letterFor(r.pct * 100);
  });

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
      if (r.qStatus[qi] === SC.STATUS.CORRECT || r.qStatus[qi] === SC.STATUS.CREDIT) c++;
    });
    itemPct.push({ n: n, correct: c, pct: n ? c / n : 0, dist: dist, blank: nBlank, multi: nMulti });
  }
  var avg = scannedRows.length
    ? scannedRows.reduce(function (a, r) { return a + r.pct; }, 0) / scannedRows.length : 0;

  var ranked = scannedRows.slice().sort(function (a, b) { return b.total - a.total; });
  ranked.forEach(function (r, i) { r.rank = i + 1; });
  rows.forEach(function (r) { r.rankOf = ranked.length; });

  var unresolved = State.scans.filter(function (sc) { return !sc.sid || !State.byId[S.normId(sc.sid)]; });

  /* Marks the reader flagged and the teacher has not yet ruled on. */
  var checks = [];
  State.scans.forEach(function (sc) {
    Object.keys(sc.checks || {}).forEach(function (k) {
      if ((sc.overrides || {})[k] != null) return;
      if ((sc.confirmed || {})[k]) return;
      checks.push({ scan: sc, q: +k, info: sc.checks[k], name: studentName(sc.sid) });
    });
  });
  checks.sort(function (a, b) { return a.q - b.q; });

  State.results = { rows: rows, scannedRows: scannedRows, itemPct: itemPct, avg: avg,
                    unresolved: unresolved, checks: checks };
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
    box.appendChild(firstRunPanel());
    $('#workflow').innerHTML = '';
    return;
  }
  box.style.display = '';
  renderStorageTotal();
  State.tests.forEach(function (t) {
    var isSel = State.test && State.test.id === t.id;
    var card = el('div', { class: 'card' + (isSel ? ' sel' : '') }, [
      el('h4', { text: t.title || 'Untitled test' }),
      el('div', { class: 'meta', text: (t.className || 'No class') + ' · ' + (t.date || '') }),
      el('div', { class: 'meta', text: t.mc.count + ' MC · ' + (t.written || []).length +
        ' written · code ' + t.code + ' · ' + S.layoutTest(t).length + ' page(s)' +
        (S.paperOf(t) !== 'letter' ? ' · ' + S.paperOf(t).toUpperCase() : '') }),
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
  renderWorkflow();
}

/* ======================================================== sample class ====
 * Anyone evaluating this — a teacher, an administrator, someone looking at a
 * portfolio — cannot print a sheet and hold it to a camera. So the app can
 * demonstrate itself: real sheets are rendered, photographed in software, and
 * pushed through exactly the same detection and scoring a camera feeds. No
 * result here is fabricated.
 */
var DEMO_NAMES = [
  'Avery Nguyen', 'Ben Carter', 'Chloe Diaz', 'Diego Ruiz',
  'Emma Sullivan', 'Farid Haddad', 'Grace Okonkwo', 'Hana Ito'
];
var DEMO_KEY = [1, 2, 0, 3, 4, 1, 2, 0, 3, 4, 1, 2];
var DEMO_TOPICS = ['Cells', 'Cells', 'Cells', 'Cells',
                   'Transport', 'Transport', 'Transport', 'Transport',
                   'Energy', 'Energy', 'Energy', 'Energy'];

function demoTest() {
  var t = newTest();
  t.id = 'demo-' + Date.now().toString(36);
  t.title = 'Unit 4 — Cell Biology';
  t.classes = ['Biology P3'];
  t.className = 'Biology P3';
  t.date = Q.todayISO();
  t.mc = { count: 12, choices: 5, key: DEMO_KEY.slice(), points: 1,
           text: [], topic: DEMO_TOPICS.slice(), rules: {} };
  t.written = [{
    label: 'Explain osmosis in your own words.', max: 6, kind: 'essay', expected: '',
    rubric: {
      levels: [{ label: 'Not yet', pts: 0 }, { label: 'Partly', pts: 1 }, { label: 'Fully', pts: 2 }],
      criteria: ['Uses the correct terms', 'Explains the mechanism', 'Gives an example']
    }
  }];
  t.options.topsheet.showMastery = true;
  t.options.footer = 'Corrections due Friday for half credit back.';
  return t;
}

function loadSampleClass(btn) {
  if (!global.QG.Synth) { Q.toast('The sample generator did not load.', 'err'); return; }
  /* Stamped up front: the backup reminder fires on a timer and must not
   * land on top of a sample the teacher is still watching build. */
  Q.Prefs.set('sampleLoadedAt', Date.now());
  if (btn) { btn.disabled = true; btn.textContent = 'Building the sample…'; }
  var Sy = global.QG.Synth;
  var t = demoTest();
  var students = DEMO_NAMES.map(function (n, i) {
    return { sid: String(i + 1), name: n, cls: 'Biology P3',
             email: n.toLowerCase().replace(/[^a-z]+/g, '.') + '@school.org' };
  });

  Q.DB.put('tests', t)
    .then(function () { return Q.DB.putMany('students', students); })
    .then(function () {
      State.tests.unshift(normalizeTest(t));
      State.students = State.students.filter(function (s) {
        return !students.some(function (d) { return S.normId(d.sid) === S.normId(s.sid); });
      }).concat(students);
      indexStudents();
      return selectTest(t);
    })
    .then(function () {
      /* Photograph every sheet, then feed them in the way Import photos does. */
      var files = [];
      var chain = Promise.resolve();
      students.forEach(function (st, i) {
        State.pages.forEach(function (pg, pi) {
          if (i === 7 && pi === 1) return;            // one student short a page
          chain = chain.then(function () {
            var answers = {};
            for (var q = 0; q < t.mc.count; q++) {
              answers[q] = (q % (i + 2) === 0) ? (DEMO_KEY[q] + 1) % 5 : DEMO_KEY[q];
            }
            if (i === 2) answers[4] = -1;                       // left one blank
            if (i === 4) answers[7] = [DEMO_KEY[7], (DEMO_KEY[7] + 1) % 5];  // two bubbles
            var sid = i === 6 ? '' : st.sid;                    // forgot to bubble
            var sheet = Sy.renderSynthetic(t, pi, { sid: sid, name: st.name, answers: answers });
            var photo = Sy.simulateCamera(sheet, {
              w: 980, h: 1110, noise: 9, vignette: 0.3,
              corners: [[150 + i * 3, 96], [880, 88 + i * 2], [905, 1010], [128, 1022]]
            });
            if (btn) btn.textContent = 'Scanning sheet ' + (files.length + 1) + '…';
            return Sy.canvasToFile(photo, st.sid + '_' + pi + '.jpg')
              .then(function (f) { files.push(f); });
          });
        });
      });
      return chain.then(function () { return Scanner.importFiles(files, { quiet: true }); });
    })
    .then(function () {
      /* Mark a couple of the written answers so grading is part-done. */
      recompute();
      State.results.rows.slice(0, 3).forEach(function (x, i) {
        if (!x.scanned) return;
        var g = State.grades[x.sid] || (State.grades[x.sid] = {});
        g.w = g.w || {};
        g.w[0] = { p: 6 - i * 2, r: [2, i === 0 ? 2 : 1, i === 0 ? 2 : 0],
                   c: i === 0 ? 'Clear and complete.' : '' };
      });
      return saveGrades();
    })
    .then(function () {
      Q.Prefs.set('sampleLoadedAt', Date.now());
      recompute();
      renderTests(); renderRosterView();
      route('review');
      Q.toast('Sample class ready — 8 students, sheets scanned. Everything here went ' +
        'through the real reader.', 'good', 8000);
    })
    .catch(function (e) {
      console.error(e);
      Q.toast('Could not build the sample: ' + e.message, 'err', 7000);
    })
    .then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'See it working with a sample class'; }
    });
}

/* ========================================================== first run ====
 * A teacher opening this for the first time gets one thing to do, not six
 * tabs. Three questions, then a printed sheet in their hand — the point at
 * which the app has actually earned another five minutes.
 */
function firstRunPanel() {
  var wrap = el('div', { class: 'firstrun' });
  wrap.appendChild(el('h2', { text: 'Let’s grade your first test' }));
  wrap.appendChild(el('p', { class: 'hint',
    text: 'Three questions and you’ll have a sheet to photocopy. About a minute.' }));

  var title = el('input', { placeholder: 'e.g. Unit 4 — Cell Biology', 'aria-label': 'Test name' });
  var cls = el('input', { placeholder: 'e.g. Biology P3', 'aria-label': 'Class name' });
  var key = el('textarea', { rows: 5, 'aria-label': 'Answer key',
    placeholder: '1. B\n2. C\n3. A\n\n…or just  B C A D E' });
  var readout = el('p', { class: 'hint' });
  var go = el('button', { class: 'btn go big', text: 'Make my answer sheet', disabled: true });

  function parsed() { return Q.Parse.parseAnswerKey(key.value); }
  function refresh() {
    var p = parsed();
    var haveKey = p.answers.length > 0;
    if (!key.value.trim()) readout.textContent = '';
    else if (!haveKey) readout.innerHTML = '<b class="bad">Can’t read that yet.</b> ' +
      'Try one answer per line, like “1. B”.';
    else readout.innerHTML = '<b class="ok">' + p.filled + ' answers</b>, ' +
      p.maxChoice + ' choices each.';
    go.disabled = !(title.value.trim() && cls.value.trim() && haveKey);
  }
  [title, cls, key].forEach(function (n) { on(n, 'input', refresh); });

  on(go, 'click', function () {
    var p = parsed();
    var t = newTest();
    t.title = title.value.trim();
    t.classes = [cls.value.trim()];
    t.className = t.classes[0];
    t.mc.count = Q.clamp(p.answers.length, 0, 300);
    t.mc.choices = Q.clamp(p.maxChoice, 2, 5);
    t.mc.key = p.answers.slice();
    var qt = Q.Parse.parseQuestionText(key.value);
    if (Object.keys(qt).length >= 2) {
      Object.keys(qt).forEach(function (n) {
        var i = parseInt(n, 10) - 1;
        if (i >= 0 && i < t.mc.count) t.mc.text[i] = qt[n];
      });
      t.options.topsheet.showQuestionText = true;
    }
    Q.DB.put('tests', t).then(function () {
      State.tests.unshift(normalizeTest(t));
      return selectTest(t);
    }).then(function () {
      renderTests(); renderRosterView();
      printSheets('blank');
      Q.toast('Test created. Print one sheet, photocopy it for the class, then come ' +
        'back and press Scan.', 'good', 9000);
    });
  });

  var steps = [
    ['What is the test called?', title, null],
    ['Which class is it for?', cls, 'You can add more classes later.'],
    ['Paste your answer key', key,
     'However you already have it written — numbered list, a run of letters, ' +
     'a column from a spreadsheet, T/F.']
  ];
  var list = el('ol', { class: 'steps' });
  steps.forEach(function (s) {
    var li = el('li', {}, [el('label', { text: s[0] }), s[1]]);
    if (s[2]) li.appendChild(el('p', { class: 'hint', text: s[2] }));
    list.appendChild(li);
  });
  list.lastChild.appendChild(readout);
  wrap.appendChild(list);
  wrap.appendChild(el('div', { class: 'row gap wrap-row' }, [
    go,
    el('button', { class: 'btn', text: 'Set it up myself',
      onclick: function () { openEditor(null); } }),
    el('button', { class: 'btn', text: 'Restore a backup',
      onclick: function () { $('#backupInput').click(); } })
  ]));
  wrap.appendChild(el('div', { class: 'demoline' }, [
    el('span', { class: 'hint', style: 'margin:0',
      text: 'Want to look around first? This builds a class of eight, prints their sheets, ' +
            'photographs them and reads them back — the real reader, no printer needed.' }),
    el('button', { class: 'btn', text: 'See it working with a sample class',
      onclick: function (e) { loadSampleClass(e.target); } })
  ]));
  wrap.appendChild(el('p', { class: 'hint', style: 'margin-top:14px',
    text: 'Everything stays on this computer. There is no account and nothing is uploaded.' }));
  setTimeout(function () { title.focus(); }, 60);
  return wrap;
}

/* A standing answer to "what do I do next?" for the selected test. */
function renderWorkflow() {
  var host = $('#workflow');
  host.innerHTML = '';
  var t = State.test;
  if (!t) return;
  recompute();
  var r = State.results;

  var keySet = 0;
  for (var i = 0; i < t.mc.count; i++) if (t.mc.key[i] != null) keySet++;
  var roster = classStudents().length;
  var scanned = r.scannedRows.length;
  var wTotal = t.written.length * scanned;
  var wDone = 0;
  r.rows.forEach(function (x) {
    if (!x.scanned) return;
    t.written.forEach(function (wq, wi) {
      var rec = (x.wRecords || {})[wi];
      if (rec && typeof rec.p === 'number') wDone++;
    });
  });

  var steps = [
    { t: 'Answer key', v: t.mc.count ? keySet + ' of ' + t.mc.count + ' set' : 'no MC questions',
      ok: !t.mc.count || keySet === t.mc.count, go: 'tests', act: 'Edit test',
      run: function () { openEditor(t); } },
    { t: 'Roster', v: roster ? roster + ' student' + (roster === 1 ? '' : 's') +
        (multiClass() ? ' across ' + t.classes.length + ' classes' : '') : 'none yet',
      ok: roster > 0, go: 'roster', act: 'Add students' },
    { t: 'Print sheets', v: State.pages.length + ' page' + (State.pages.length === 1 ? '' : 's') + ' each',
      ok: roster > 0, go: 'roster', act: 'Print' },
    { t: 'Scan', v: scanned + ' of ' + (roster || '?') + ' scanned' +
        (r.unresolved.length ? ' · ' + r.unresolved.length + ' unmatched' : ''),
      ok: roster > 0 && scanned >= roster && !r.unresolved.length,
      warn: r.unresolved.length > 0, go: 'scan', act: 'Scan' },
    { t: 'Grade written', v: t.written.length ? wDone + ' of ' + wTotal + ' graded' : 'none on this test',
      ok: !t.written.length || (wTotal > 0 && wDone === wTotal), go: 'written', act: 'Grade' },
    { t: 'Export', v: scanned ? 'ready' : 'nothing to export yet',
      ok: false, go: 'export', act: 'Export' }
  ];

  var firstTodo = steps.findIndex(function (s) { return !s.ok; });
  var flow = el('div', { class: 'flow' });
  steps.forEach(function (s, i) {
    var cls = 'step' + (s.ok ? ' done' : '') + (s.warn ? ' warn' : '') +
              (i === firstTodo ? ' now' : '');
    flow.appendChild(el('div', { class: cls }, [
      el('span', { class: 'sn', text: s.ok ? '✓' : String(i + 1) }),
      el('div', { class: 'sb' }, [
        el('b', { text: s.t }),
        el('span', { text: s.v })
      ]),
      el('button', {
        class: 'btn sm' + (i === firstTodo ? ' go' : ''), text: s.act,
        onclick: function () { if (s.run) s.run(); else route(s.go); }
      })
    ]));
  });
  host.appendChild(el('h3', { text: 'Where this test stands' }));
  host.appendChild(flow);
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
  $('#f_idDigits').value = String(S.idDigitsOf(editing));
  $('#f_idLabel').value = editing.options.idLabel || '';
  $('#f_paper').value = S.paperOf(editing);
  var lb = editing.options.labels || (editing.options.labels = {});
  $('#f_lblName').value = lb.name || '';
  $('#f_lblClass').value = lb.cls || '';
  $('#f_lblPage').value = lb.page || '';
  $('#f_lblHowto').value = lb.howto || '';
  $('#f_lblSamples').value = lb.samples || '';
  $('#f_lblTips').value = lb.tips || '';
  $('#f_wPerPage').value = editing.options.wPerPage;
  $('#f_instr').value = editing.options.instructions || '';
  renderKeyGrid();
  renderTopics();
  renderForms();
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

/* ---- paste an answer key in whatever shape the teacher already has it ---- */
/**
 * pasteKeyDialog(onApply)
 * Without a callback it sets up the whole test (question count, choices, key).
 * With one, it is filling in a second version's key, so the question count is
 * already fixed and must match.
 */
function pasteKeyDialog(onApply) {
  var ta = el('textarea', { rows: 9, 'aria-label': 'Answer key',
    placeholder: '1. B\n2. C\n3. A\n\n…or  B C A D E\n…or paste a column straight out of a spreadsheet' });
  var summary = el('p', { class: 'hint' });
  var warnBox = el('div');
  var preview = el('div', { class: 'keygrid', style: 'max-height:180px;overflow:auto' });
  var parsed = null, qtext = {};
  /* If they pasted the questions along with the key, keep the wording too —
   * it costs them nothing and makes the graded top sheet far more useful. */
  var qtWrap = el('div', { hidden: true });
  var qtBox = el('input', { type: 'checkbox', checked: true });
  var qtLabel = el('label', { class: 'chk', style: 'margin:8px 0' }, [qtBox, el('span', {})]);
  qtWrap.appendChild(qtLabel);

  function refresh() {
    parsed = Q.Parse.parseAnswerKey(ta.value);
    qtext = Q.Parse.parseQuestionText(ta.value);
    var nQt = Object.keys(qtext).length;
    qtWrap.hidden = nQt < 2;
    qtLabel.lastChild.textContent = 'Also keep the wording of ' + nQt +
      ' question(s), to print on the graded sheet students get back';
    preview.innerHTML = '';
    warnBox.innerHTML = '';
    if (!ta.value.trim()) { summary.textContent = ''; applyBtn.disabled = true; return; }
    if (!parsed.answers.length) {
      summary.innerHTML = '<b class="bad">Could not read that.</b>';
      (parsed.warnings || []).forEach(function (w) {
        warnBox.appendChild(el('p', { class: 'hint', text: w }));
      });
      applyBtn.disabled = true;
      return;
    }
    summary.innerHTML = '<b class="ok">Found ' + parsed.filled + ' answer' +
      (parsed.filled === 1 ? '' : 's') + '</b> — read as a ' + parsed.mode +
      ', with ' + parsed.maxChoice + ' choices per question.';
    (parsed.warnings || []).forEach(function (w) {
      warnBox.appendChild(el('p', { class: 'hint warnc', text: '⚠ ' + w }));
    });
    parsed.answers.forEach(function (a, i) {
      preview.appendChild(el('div', { class: 'keyitem' }, [
        el('span', { class: 'qn', text: (i + 1) + '.' }),
        el('span', { class: a == null ? 'bad' : 'ok',
          style: 'font-weight:700', text: a == null ? '—' : S.LETTERS[a] })
      ]));
    });
    applyBtn.disabled = false;
  }

  var applyBtn = el('button', {
    class: 'btn go', text: 'Use this key', disabled: true,
    onclick: function () {
      if (!parsed || !parsed.answers.length) return;
      if (onApply) {
        /* A second version must line up question-for-question with version A,
         * otherwise the two are not the same test. */
        if (parsed.answers.length !== editing.mc.count) {
          Q.toast('That key has ' + parsed.answers.length + ' answers but the test has ' +
            editing.mc.count + ' questions. Every version needs the same number.', 'err', 8000);
          return;
        }
        onApply(parsed);
        h.close();
        Q.toast('Key set for that version.', 'good');
        return;
      }
      editing.mc.count = Q.clamp(parsed.answers.length, 0, 300);
      editing.mc.choices = Q.clamp(parsed.maxChoice, 2, 5);
      editing.mc.key = parsed.answers.slice();
      if (!qtWrap.hidden && qtBox.checked) {
        editing.mc.text = editing.mc.text || [];
        Object.keys(qtext).forEach(function (n) {
          var i = parseInt(n, 10) - 1;
          if (i >= 0 && i < editing.mc.count) editing.mc.text[i] = qtext[n];
        });
        editing.options.topsheet.showQuestionText = true;
      }
      $('#f_mcCount').value = editing.mc.count;
      $('#f_choices').value = editing.mc.choices;
      renderKeyGrid();
      h.close();
      Q.toast('Key set: ' + parsed.filled + ' answers, ' + editing.mc.choices +
        ' choices. Check it below before saving.', 'good', 6000);
    }
  });

  var body = el('div', {}, [
    el('h3', { text: 'Paste your answer key' }),
    el('p', { class: 'hint', text: 'However you already have it written — a numbered list, ' +
      'a run of letters, a column copied out of a spreadsheet, T/F, upper or lower case. ' +
      'Nothing is changed until you press the button.' }),
    ta, summary, warnBox, qtWrap,
    el('div', { style: 'margin-top:6px' }, [preview]),
    el('div', { class: 'row gap end', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); } }),
      applyBtn
    ])
  ]);
  var h = Q.modal(body);
  on(ta, 'input', refresh);
  setTimeout(function () { ta.focus(); }, 40);
}

/* ---- paste written questions, with their point values ---- */
function pasteWrittenDialog() {
  var ta = el('textarea', { rows: 8, 'aria-label': 'Written questions',
    placeholder: 'Explain osmosis in your own words. (5 points)\nName three organelles - 6 pts\nCompare mitosis and meiosis' });
  var summary = el('p', { class: 'hint' });
  var list = el('div');
  var parsed = [];

  function refresh() {
    parsed = Q.Parse.parseWritten(ta.value, 5);
    list.innerHTML = '';
    summary.textContent = parsed.length
      ? 'Found ' + parsed.length + ' question' + (parsed.length === 1 ? '' : 's') +
        ', worth ' + parsed.reduce(function (a, w) { return a + w.max; }, 0) + ' points in total.'
      : '';
    parsed.forEach(function (w, i) {
      list.appendChild(el('div', { class: 'fmtcol' }, [
        el('span', { class: 'fname', text: (i + 1) + '. ' + w.label }),
        el('span', { class: 'dim', text: w.max + ' pts' })
      ]));
    });
    applyBtn.disabled = !parsed.length;
  }
  var applyBtn = el('button', {
    class: 'btn go', text: 'Add these questions', disabled: true,
    onclick: function () {
      editing.written = (editing.written || []).concat(parsed);
      renderWrittenList();
      h.close();
      Q.toast('Added ' + parsed.length + ' written question(s).', 'good');
    }
  });
  var body = el('div', {}, [
    el('h3', { text: 'Paste your written questions' }),
    el('p', { class: 'hint', text: 'One per line. Put the points in brackets or after a dash — ' +
      '"(5 points)", "- 6 pts", or a tab. Anything without points is worth 5.' }),
    ta, summary, list,
    el('div', { class: 'row gap end', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); } }),
      applyBtn
    ])
  ]);
  var h = Q.modal(body);
  on(ta, 'input', refresh);
  setTimeout(function () { ta.focus(); }, 40);
}

/* ==================================================== standards tagging ==
 * Which objective each question tests. Pasted in whatever shape the teacher
 * already keeps it, then shown back before it is applied.
 */
function pasteTopicsDialog() {
  var ta = el('textarea', { rows: 8, 'aria-label': 'Objectives',
    placeholder: 'Cells: 1-8\nTransport: 9-16\nEnergy: 17-24\n\n' +
      '…or  1. Cells   …or one objective per line, in question order' });
  var summary = el('p', { class: 'hint' });
  var warnBox = el('div');
  var preview = el('div', { class: 'topicprev' });
  var parsed = null;

  function refresh() {
    parsed = Q.Parse.parseTopics(ta.value, editing.mc.count);
    preview.innerHTML = ''; warnBox.innerHTML = '';
    if (!ta.value.trim()) { summary.textContent = ''; applyBtn.disabled = true; return; }
    summary.innerHTML = '<b class="ok">' + parsed.assigned + ' of ' + editing.mc.count +
      ' questions tagged</b> — read as a ' + parsed.mode + '.';
    (parsed.warnings || []).forEach(function (w) {
      warnBox.appendChild(el('p', { class: 'hint warnc', text: '⚠ ' + w }));
    });
    var groups = {}, order = [];
    parsed.topics.forEach(function (t, i) {
      if (!t) return;
      if (!groups[t]) { groups[t] = []; order.push(t); }
      groups[t].push(i + 1);
    });
    order.forEach(function (name) {
      preview.appendChild(el('div', { class: 'topicrow' }, [
        el('b', { text: name }),
        el('span', { class: 'dim', text: groups[name].length + ' question' +
          (groups[name].length === 1 ? '' : 's') + ': ' + groups[name].join(', ') })
      ]));
    });
    applyBtn.disabled = !parsed.assigned;
  }
  var applyBtn = el('button', {
    class: 'btn go', text: 'Use these objectives', disabled: true,
    onclick: function () {
      editing.mc.topic = parsed.topics.slice();
      editing.options.topsheet.showMastery = true;
      renderTopics();
      h.close();
      Q.toast('Tagged ' + parsed.assigned + ' questions. Mastery will now show in Review ' +
        'and on the sheets students get back.', 'good', 7000);
    }
  });
  var body = el('div', {}, [
    el('h3', { text: 'What does each question test?' }),
    el('p', { class: 'hint', text: 'Standards, objectives, topics — whatever you call them. ' +
      'List a name with the questions it covers, or one name per line in question order.' }),
    ta, summary, warnBox, preview,
    el('div', { class: 'row gap end', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); } }),
      applyBtn
    ])
  ]);
  var h = Q.modal(body);
  on(ta, 'input', refresh);
  setTimeout(function () { ta.focus(); }, 40);
}

function renderTopics() {
  var box = $('#topicsList');
  if (!box) return;
  box.innerHTML = '';
  var stds = Q.Mastery.standardsOf(editing);
  if (!stds.length) {
    box.appendChild(el('p', { class: 'hint',
      text: 'Not tagged yet. Optional — but it turns a percentage into a list of what to reteach.' }));
    return;
  }
  stds.forEach(function (s) {
    box.appendChild(el('div', { class: 'topicrow' }, [
      el('b', { text: s.name }),
      el('span', { class: 'dim', text: s.questions.length + ' question' +
        (s.questions.length === 1 ? '' : 's') }),
      el('button', { class: 'btn sm danger', text: '×', title: 'Remove this objective',
        onclick: function () {
          s.questions.forEach(function (q) { editing.mc.topic[q] = ''; });
          renderTopics();
        } })
    ]));
  });
  var untagged = editing.mc.count - stds.reduce(function (a, s) { return a + s.questions.length; }, 0);
  if (untagged > 0) {
    box.appendChild(el('p', { class: 'hint warnc',
      text: untagged + ' question(s) are not tagged and will not appear in any mastery report.' }));
  }
}

/* ---- class mastery, on the Review screen ---- */
function renderMastery() {
  var host = $('#masteryBox');
  if (!host) return;
  host.innerHTML = '';
  var t = State.test, r = State.results;
  if (!t || !r || !Q.Mastery.isTagged(t) || !r.scannedRows.length) return;

  var list = Q.Mastery.forClass(t, r);
  host.appendChild(el('div', { class: 'row between wrap-row' }, [
    el('h2', { text: 'What the class has and hasn’t got' }),
    el('span', { class: 'hint', text: Q.Mastery.classHeadline(t, r) })
  ]));

  var tb = el('tbody');
  list.forEach(function (s) {
    var pct = Math.round(s.pct * 100);
    var lvl = Q.Mastery.levelFor(t, s.pct);
    tb.appendChild(el('tr', {}, [
      el('td', { text: s.name }),
      el('td', { class: 'mono dim', text: s.questions.map(function (q) { return q + 1; }).join(', ') }),
      el('td', {}, [el('div', { class: 'qbar' + (lvl.id === 'notyet' ? ' hard' : '') },
        [el('i', { style: 'width:' + Math.max(2, pct) + '%' })])]),
      el('td', { class: 'mono', text: pct + '%' }),
      el('td', {}, [el('span', { class: 'lvl ' + lvl.id, text: lvl.label })]),
      el('td', { class: 'dim', text: s.secure + ' secure · ' + s.developing +
        ' developing · ' + s.notyet + ' not yet' })
    ]));
  });
  host.appendChild(el('div', { class: 'tbl' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Objective', 'Questions', 'Class', '', 'Level', 'Students']
        .map(function (h) { return el('th', { text: h }); }))]),
      tb
    ])
  ]));
}

/* ======================================================== test versions ==
 * Two students sitting next to each other get different question orders. The
 * teacher scrambles their own test document; QuickGrade only needs the answer
 * key for each version, and gives each one its own printed code so a mixed
 * pile of sheets sorts itself out during scanning.
 */
function nextFormLetter() {
  var used = SC.formsOf(editing).map(function (f) { return f.id; });
  for (var i = 0; i < 26; i++) {
    var c = String.fromCharCode(65 + i);
    if (used.indexOf(c) < 0) return c;
  }
  return 'X';
}
function unusedCode() {
  var used = {};
  State.tests.forEach(function (t) {
    SC.formsOf(t).forEach(function (f) { used[String(f.code)] = 1; });
  });
  SC.formsOf(editing).forEach(function (f) { used[String(f.code)] = 1; });
  for (var i = 0; i < 900; i++) {
    var c = S.digits(String(101 + i), 3).join('');
    if (!used[c]) return c;
  }
  return String(Math.floor(Math.random() * 900) + 100);
}

function renderForms() {
  var box = $('#formsList');
  box.innerHTML = '';
  var forms = SC.formsOf(editing);

  forms.forEach(function (f, i) {
    var filled = (f.key || []).filter(function (k) { return k != null; }).length;
    var row = el('div', { class: 'formrow' });
    row.appendChild(el('span', { class: 'vtag', text: f.id }));

    var code = el('input', { value: f.code, maxlength: 3, inputmode: 'numeric',
      style: 'width:78px', 'aria-label': 'Printed code for version ' + f.id });
    on(code, 'change', function () {
      var v = S.digits(code.value, 3).join('');
      code.value = v;
      if (f.primary) editing.code = v; else editing.forms[i - 1].code = v;
      renderForms();
    });
    row.appendChild(el('span', { class: 'hint', style: 'margin:0', text: 'code' }));
    row.appendChild(code);

    row.appendChild(el('span', {
      class: filled === editing.mc.count && editing.mc.count ? 'ok' : 'warnc',
      style: 'font-size:12.5px',
      text: filled + ' of ' + editing.mc.count + ' answers'
    }));

    row.appendChild(el('button', {
      class: 'btn sm' + (filled ? '' : ' go'), text: filled ? 'Change key' : 'Paste key',
      onclick: function () {
        if (f.primary) { pasteKeyDialog(); return; }
        pasteKeyDialog(function (parsed) {
          editing.forms[i - 1].key = parsed.answers.slice();
          renderForms();
        });
      }
    }));

    if (!f.primary) {
      row.appendChild(el('button', {
        class: 'btn sm danger', text: 'Remove',
        onclick: function () { editing.forms.splice(i - 1, 1); renderForms(); }
      }));
    }
    box.appendChild(row);
  });

  var dupes = {};
  var clash = forms.filter(function (f) {
    if (dupes[f.code]) return true;
    dupes[f.code] = 1;
    return false;
  });
  if (clash.length) {
    box.appendChild(el('p', { class: 'hint bad',
      text: 'Two versions share the code ' + clash[0].code +
        '. Give each one a different code or the scanner cannot tell them apart.' }));
  }
  $('#btnAddForm').textContent = forms.length > 1
    ? '+ Add version ' + nextFormLetter() : '+ Add a second version';
}

/* ========================================================= rubric setup ==
 * One shared set of levels across all criteria — that is how classroom
 * rubrics are usually written, and it keeps marking to one keystroke per
 * criterion.
 */
function rubricDialog(wi) {
  var wq = editing.written[wi];
  var draft = wq.rubric
    ? JSON.parse(JSON.stringify(wq.rubric))
    : { levels: JSON.parse(JSON.stringify(SC.DEFAULT_LEVELS)), criteria: [] };

  var levelBox = el('div', { class: 'topicprev' });
  var critArea = el('textarea', { rows: 5, 'aria-label': 'Criteria, one per line',
    placeholder: 'Uses the correct terms\nExplains the mechanism\nGives an example' });
  critArea.value = draft.criteria.join('\n');
  var summary = el('p', { class: 'hint' });

  function refresh() {
    levelBox.innerHTML = '';
    draft.levels.forEach(function (lv, i) {
      var row = el('div', { class: 'topicrow' });
      var lab = el('input', { value: lv.label, 'aria-label': 'Level name',
        oninput: function (e) { lv.label = e.target.value; } });
      var pts = el('input', { type: 'number', step: '0.5', value: lv.pts, style: 'width:82px',
        'aria-label': 'Points for ' + lv.label,
        oninput: function (e) { lv.pts = parseFloat(e.target.value) || 0; refreshSummary(); } });
      row.appendChild(lab);
      row.appendChild(pts);
      row.appendChild(el('button', { class: 'btn sm danger', text: '×', title: 'Remove level',
        disabled: draft.levels.length <= 2,
        onclick: function () { draft.levels.splice(i, 1); refresh(); } }));
      levelBox.appendChild(row);
    });
    refreshSummary();
  }
  function criteria() {
    return critArea.value.split(/\r?\n/).map(function (c) { return c.trim(); }).filter(Boolean);
  }
  function refreshSummary() {
    draft.criteria = criteria();
    var max = SC.rubricMax(draft);
    summary.innerHTML = draft.criteria.length
      ? '<b class="ok">' + draft.criteria.length + ' criteria</b> × top level of ' +
        Math.max.apply(null, draft.levels.map(function (l) { return l.pts || 0; })) +
        ' = <b>' + max + ' points</b> for this question.'
      : 'Add at least one criterion.';
    applyBtn.disabled = !draft.criteria.length;
  }
  on(critArea, 'input', refreshSummary);

  var applyBtn = el('button', {
    class: 'btn go', text: 'Use this rubric',
    onclick: function () {
      draft.criteria = criteria();
      wq.rubric = draft;
      wq.max = SC.rubricMax(draft);
      renderWrittenList();
      h.close();
      Q.toast('Rubric set — this question is now worth ' + wq.max + '.', 'good');
    }
  });

  var body = el('div', {}, [
    el('h3', { text: 'Rubric for “' + (wq.label || 'this question') + '”' }),
    el('p', { class: 'hint', text: 'The same levels apply to every criterion, so marking is ' +
      'one key per criterion. The question total follows automatically.' }),
    el('label', { text: 'Levels' }), levelBox,
    el('button', { class: 'btn sm', text: '+ Add level',
      onclick: function () {
        var top = Math.max.apply(null, draft.levels.map(function (l) { return l.pts || 0; }));
        draft.levels.push({ label: 'Level ' + (draft.levels.length + 1), pts: top + 1 });
        refresh();
      } }),
    el('label', { text: 'Criteria, one per line', style: 'margin-top:16px' }), critArea,
    summary,
    el('div', { class: 'row gap end', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); } }),
      wq.rubric ? el('button', { class: 'btn danger', text: 'Remove rubric',
        onclick: function () {
          delete wq.rubric; renderWrittenList(); h.close();
          Q.toast('Rubric removed — back to a single mark out of ' + wq.max + '.', 'good');
        } }) : null,
      applyBtn
    ])
  ]);
  var h = Q.modal(body);
  refresh();
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
      el('button', { class: 'btn sm' + (w.rubric ? ' go' : ''),
        text: w.rubric ? 'Rubric · ' + w.rubric.criteria.length : 'Rubric',
        title: w.rubric ? 'Edit the rubric' : 'Mark against criteria instead of one number',
        onclick: function () { rubricDialog(i); } }),
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
  editing.classes = $('#f_class').value.split(/\s*[,;]\s*/)
    .map(function (c) { return c.trim(); }).filter(Boolean);
  editing.className = editing.classes.join(', ');
  editing.date = $('#f_date').value;
  editing.code = S.digits($('#f_code').value || editing.code, 3).join('');
  editing.mc.count = Q.clamp(parseInt($('#f_mcCount').value, 10) || 0, 0, 300);
  editing.mc.choices = parseInt($('#f_choices').value, 10) || 5;
  editing.mc.points = parseFloat($('#f_mcPoints').value);
  if (isNaN(editing.mc.points)) editing.mc.points = 1;
  editing.options.prefillId = $('#f_prefillId').checked;
  editing.options.idDigits = parseInt($('#f_idDigits').value, 10) || 3;
  editing.options.idLabel = $('#f_idLabel').value.trim();
  editing.options.paper = $('#f_paper').value;
  editing.options.labels = {
    name: $('#f_lblName').value.trim(), cls: $('#f_lblClass').value.trim(),
    page: $('#f_lblPage').value.trim(), howto: $('#f_lblHowto').value.trim(),
    samples: $('#f_lblSamples').value.trim(), tips: $('#f_lblTips').value.trim()
  };
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
  var inp = $('#rosterClass');
  var v = inp && inp.value ? inp.value.trim() : '';
  return v || (State.test ? (State.test.classes || [])[0] || '' : '');
}
/** Only shown when a test actually has more than one version. */
function renderPrintForms() {
  var sel = $('#printForm');
  if (!sel) return;
  var t = State.test;
  var forms = t ? SC.formsOf(t) : [];
  sel.hidden = forms.length < 2;
  if (sel.hidden) return;
  var keep = sel.value;
  sel.innerHTML = '';
  forms.forEach(function (f) {
    sel.appendChild(el('option', { value: f.id }, 'Version ' + f.id + '  (code ' + f.code + ')'));
  });
  if (keep) sel.value = keep;
}

function renderRosterView() {
  var inp = $('#rosterClass');
  var classes = allClasses();
  if (!inp.value) {
    inp.value = (State.test && (State.test.classes || [])[0]) || classes[0] || '';
  }
  var dl = $('#classChoices');
  dl.innerHTML = '';
  classes.forEach(function (c) { dl.appendChild(el('option', { value: c })); });
  renderRosterTable();
  renderPrintForms();
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
      el('td', { class: 'dim', text: s.email || '' }),
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
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Name' }), el('th', { text: 'No.' }),
      el('th', { text: 'Email' }), el('th', {})])]), tb
  ]));
}
/* Short sequential ids: a student can bubble "042" in seconds, and one master
 * sheet photocopies for the whole class. Long legacy ids are left alone but
 * ignored when picking the next number. */
function nextSid() {
  var max = 0;
  State.students.forEach(function (s) {
    var n = parseInt(S.normId(s.sid), 10);
    if (!isNaN(n) && n < 10000 && n > max && !/^9+$/.test(S.normId(s.sid))) max = n;
  });
  return String(max + 1);
}

/** Warn when the roster cannot be represented by the sheet's ID width. */
function idWidthProblem(t) {
  var n = S.idDigitsOf(t);
  var tooLong = classStudents().filter(function (s) { return S.normId(s.sid).length > n; });
  if (!tooLong.length) return null;
  return tooLong.length + ' student id(s) need more than ' + n + ' digits (e.g. ' +
    S.normId(tooLong[0].sid) + ' — ' + tooLong[0].name + '). Raise the ID length on the test, ' +
    'or renumber the roster.';
}
function saveRosterPaste() {
  var cls = currentClass();
  if (!cls) { Q.toast('Type a class name first.', 'err'); $('#rosterClass').focus(); return; }
  var lines = $('#rosterPaste').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) { Q.toast('Nothing to add.', 'err'); return; }
  var add = [], taken = {};
  State.students.forEach(function (s) { taken[s.sid] = 1; });
  var counter = parseInt(nextSid(), 10);
  lines.forEach(function (line) {
    /* A line is "Name", "Name, id", "Name, email", or "Name, id, email" —
     * the email is whichever field has an @ in it, so order does not matter. */
    var m = line.split(/\s*[,\t]\s*/);
    var name = m[0].trim();
    if (!name) return;
    var email = '';
    var rest = [];
    for (var mi = 1; mi < m.length; mi++) {
      var f = (m[mi] || '').trim();
      if (!f) continue;
      if (f.indexOf('@') >= 0) email = f; else rest.push(f);
    }
    var sid = S.normId(rest[0] || '');

    if (!sid) {
      var existing = State.students.filter(function (s) {
        return s.cls === cls && s.name.toLowerCase() === name.toLowerCase();
      })[0];
      if (existing) sid = S.normId(existing.sid);
      else { while (taken[String(counter)]) counter++; sid = String(counter); counter++; }
    }
    if (/^9+$/.test(sid)) {
      Q.toast('An all-nines number is reserved for the answer key — skipped ' + name, 'err');
      return;
    }
    taken[sid] = 1;
    add.push({ sid: sid, name: name, cls: cls, email: email });
  });
  add.forEach(function (a) {
    if (a.email) return;
    var prev = State.students.filter(function (x) { return S.normId(x.sid) === S.normId(a.sid); })[0];
    if (prev && prev.email) a.email = prev.email;
  });
  Q.DB.putMany('students', add).then(function () {
    add.forEach(function (s) {
      var i = State.students.findIndex(function (x) { return x.sid === s.sid; });
      if (i >= 0) State.students[i] = s; else State.students.push(s);
    });
    indexStudents();
    /* renderRosterView, not just the table: a class created just now must
     * appear in the suggestion list without a reload. */
    renderRosterView(); recompute();
    $('#rosterPaste').value = '';
    Q.toast('Saved ' + add.length + ' student' + (add.length === 1 ? '' : 's') + '.', 'good');
  });
}

/* ---- CSV roster import ----
 * Gradebook exports are messy: quoted fields, a header row, "Last, First"
 * split across two columns, and a dozen columns nobody needs. Work out which
 * columns hold the name and the id rather than demanding a fixed format. */
function parseCsv(text) {
  var rows = [], row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  var delim = (text.split('\t').length > text.split(',').length) ? '\t' : ',';
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
}

function importRosterCsv(file) {
  var cls = currentClass();
  if (!cls) { Q.toast('Type a class name first.', 'err'); $('#rosterClass').focus(); return; }
  Q.readFileText(file).then(function (txt) {
    var rows = parseCsv(txt);
    if (!rows.length) { Q.toast('That file looked empty.', 'err'); return; }

    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var looksLikeHeader = head.some(function (h) {
      return /name|student|id|number|first|last|surname/.test(h);
    });
    var body = looksLikeHeader ? rows.slice(1) : rows;

    function findCol(re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; }
    var iFull = looksLikeHeader ? findCol(/^(student|full ?name|name|student name)$/) : -1;
    var iLast = looksLikeHeader ? findCol(/last|surname|family/) : -1;
    var iFirst = looksLikeHeader ? findCol(/first|given/) : -1;
    var iId = looksLikeHeader ? findCol(/id|number|no\.?$/) : -1;
    var iMail = looksLikeHeader ? findCol(/e-?mail/) : -1;

    if (iFull < 0 && iLast < 0) {
      /* No usable header: assume the widest text column is the name. */
      var best = 0, bestLen = -1;
      for (var c = 0; c < (body[0] || []).length; c++) {
        var len = 0, n = 0;
        body.forEach(function (r) {
          var v = String(r[c] || '').trim();
          if (v && !/^\d+$/.test(v)) { len += v.length; n++; }
        });
        var avg = n ? len / n : 0;
        if (avg > bestLen) { bestLen = avg; best = c; }
      }
      iFull = best;
    }

    var lines = [];
    body.forEach(function (r) {
      var name = '';
      if (iLast >= 0) {
        name = ((r[iFirst] || '') + ' ' + (r[iLast] || '')).trim();
      } else {
        name = String(r[iFull] || '').trim();
        var m = name.match(/^([^,]+),\s*(.+)$/);        // "Nguyen, Avery"
        if (m) name = (m[2] + ' ' + m[1]).trim();
      }
      if (!name) return;
      var id = iId >= 0 ? String(r[iId] || '').replace(/\D/g, '') : '';
      var mail = '';
      if (iMail >= 0) mail = String(r[iMail] || '').trim();
      else { r.forEach(function (v) { if (!mail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim())) mail = String(v).trim(); }); }
      lines.push([name, id, mail].filter(function (x, i) { return i === 0 || x; }).join(', '));
    });

    if (!lines.length) { Q.toast('Could not find any names in that file.', 'err', 6000); return; }
    $('#rosterPaste').value = lines.join('\n');
    Q.toast('Found ' + lines.length + ' student(s). Check the list, then press ' +
      '"Add / update students".', 'good', 7000);
  }).catch(function (e) { Q.toast('Could not read that file: ' + e.message, 'err', 6000); });
}

function printSheets(mode, formId) {
  var t = State.test;
  if (!t) { Q.toast('Select a test first.', 'err'); return; }
  var form = SC.variantOf(t, formId);
  var problem = idWidthProblem(t);
  if (problem) { Q.toast(problem, 'err', 9000); return; }
  var people, opts = { prefill: false, keyMode: false, form: form };
  if (mode === 'personal') {
    people = classStudents();
    if (!people.length) { Q.toast('No students in "' + (t.className || '') + '". Add a roster first.', 'err', 5000); return; }
    opts.prefill = !!t.options.prefillId;
  } else if (mode === 'key') {
    people = [{ sid: S.keySid(S.idDigitsOf(t)),
                 name: 'ANSWER KEY' + (form.primary ? '' : ' — VERSION ' + form.id),
                 cls: t.className }];
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
    if (S.isKeySid(record.sid, S.idDigitsOf(t))) {
      var page = State.pages[record.page - 1];
      /* a key sheet updates the version whose code it carries */
      var kf = SC.formByCode(t, record.code) || SC.variantOf(t, null);
      var target = kf.primary ? t.mc.key
        : (t.forms.filter(function (f) { return f.id === kf.id; })[0] || {}).key;
      page.mc.forEach(function (item) {
        var a = record.answers[item.q];
        if (a >= 0 && target) target[item.q] = a;
      });
      return saveTest().then(function () { recompute(); return { status: 'key' }; });
    }

    var known = record.sid && State.byId[S.normId(record.sid)];
    var replaced = null;
    if (record.sid) {
      replaced = State.scans.filter(function (s) {
        return S.normId(s.sid) === S.normId(record.sid) && s.page === record.page;
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
        var mine = State.scans.filter(function (s) { return S.normId(s.sid) === S.normId(record.sid); });
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
  Object.keys(sc.checks || {}).forEach(function (k) {
    if (sc.checks[k] && sc.checks[k].blob) ids.push(sc.checks[k].blob);
  });
  return ids;
}
/** Reversible delete. Images are kept so a restore is complete. */
function deleteScan(sc) {
  sc.deleted = Date.now();
  return Q.DB.put('scans', sc).then(function () {
    State.scans = State.scans.filter(function (s) { return s.id !== sc.id; });
    if (State.trash.indexOf(sc) < 0) State.trash.push(sc);
    recompute();
  });
}
function restoreScans(list) {
  list.forEach(function (sc) { delete sc.deleted; });
  return Q.DB.putMany('scans', list).then(function () {
    list.forEach(function (sc) {
      State.trash = State.trash.filter(function (s) { return s.id !== sc.id; });
      if (State.scans.indexOf(sc) < 0) State.scans.push(sc);
    });
    recompute();
  });
}
/** Irreversible. Used by "delete permanently" and when a test is removed. */
function purgeScans(list) {
  var ids = [], blobs = [];
  list.forEach(function (sc) { ids.push(sc.id); blobs = blobs.concat(collectBlobIds(sc)); });
  return Q.DB.delMany('scans', ids)
    .then(function () { return blobs.length ? Q.DB.delMany('blobs', blobs) : null; })
    .then(function () {
      State.trash = State.trash.filter(function (s) { return ids.indexOf(s.id) < 0; });
      State.scans = State.scans.filter(function (s) { return ids.indexOf(s.id) < 0; });
      recompute();
    });
}

function renderTrash() {
  var host = $('#trashBox');
  host.innerHTML = '';
  if (!State.trash.length) return;
  var n = State.trash.length;
  host.appendChild(el('div', { class: 'trashbar' }, [
    el('span', { text: n + ' deleted sheet' + (n === 1 ? '' : 's') + ' can still be brought back.' }),
    el('button', { class: 'btn sm go', text: 'Bring them back',
      onclick: function () {
        restoreScans(State.trash.slice()).then(function () {
          renderReview();
          Q.toast('Restored ' + n + ' sheet(s).', 'good');
        });
      } }),
    el('button', { class: 'btn sm danger', text: 'Delete permanently',
      onclick: function () {
        Q.confirmBox('Permanently delete ' + n + ' sheet(s)? This cannot be undone.',
          'Delete for good').then(function (yes) {
          if (!yes) return;
          purgeScans(State.trash.slice()).then(function () { renderReview(); });
        });
      } })
  ]));
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

  renderTrash();
  renderChecks();
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
    if (!x.scanned) {
      flags.push(r.unresolved.length
        ? 'not scanned — check the unmatched sheets above'
        : 'not scanned');
    }
    else {
      if (x.missing.length) flags.push('missing p' + x.missing.join(',p'));
      if (x.multi) flags.push(x.multi + ' double-marked');
      if (x.blank) flags.push(x.blank + ' blank');
    }
    var cells = [
      el('td', { text: x.name }),
      el('td', { class: 'dim', text: x.sid })
    ];
    if (multiClass()) cells.push(el('td', { class: 'dim', text: (State.byId[x.sid] || {}).cls || '' }));
    if (SC.hasForms(State.test)) {
      cells.push(el('td', {}, [el('span', { class: 'vtag sm', text: x.scanned ? x.form : '—' })]));
    }
    tb.appendChild(el('tr', {}, cells.concat([
      el('td', {}, pageCells),
      el('td', { text: x.scanned ? x.correct + '/' + State.test.mc.count : '—' }),
      el('td', { text: State.test.written.length ? x.wGraded + '/' + State.test.written.length : '—' }),
      el('td', { text: x.scanned ? x.total + '/' + x.max + '  (' + Math.round(x.pct * 100) + '%)' : '—' }),
      el('td', { class: flags.length ? 'warnc' : 'dim', text: flags.join(' · ') || 'ok' }),
      el('td', {}, [el('button', {
        class: 'btn sm', text: 'Sheets',
        onclick: function () { viewStudentSheets(x); }
      })])
    ])));
  });
  var heads = ['Student', 'ID'].concat(multiClass() ? ['Class'] : [])
    .concat(SC.hasForms(State.test) ? ['Ver'] : [])
    .concat(['Pages', 'MC', 'Written', 'Score', 'Notes', '']);
  var t = el('table', {}, [
    el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]), tb
  ]);
  var host = $('#reviewTable');
  host.innerHTML = '';
  host.appendChild(el('div', { class: 'tbl' }, [t]));
  renderMastery();
  renderQuestionTable();
}

/* ---- "Marks I wasn't sure about" — the reader shows its working ---- */
function renderChecks() {
  var host = $('#checksBox');
  host.innerHTML = '';
  var r = State.results, t = State.test;
  if (!r) return;
  var list = r.checks;
  if (!list.length) {
    if (State.scans.length) {
      host.appendChild(el('div', { class: 'clearbox' }, [
        el('span', { text: '✓ Every mark on ' + State.scans.length + ' scanned page' +
          (State.scans.length === 1 ? '' : 's') + ' read cleanly. Nothing needs a second look.' })
      ]));
    }
    return;
  }

  var wrap = el('div', { class: 'checks' }, [
    el('h3', { text: list.length + ' mark' + (list.length === 1 ? '' : 's') + ' worth a second look' }),
    el('p', { class: 'hint', text: 'These were read, but not cleanly. The strip is the actual paper. ' +
      'Confirm it or correct it — either way it stops asking.' })
  ]);

  list.slice(0, 40).forEach(function (c) {
    var row = el('div', { class: 'checkrow' });
    row.appendChild(el('div', { class: 'cq' }, [
      el('b', { text: 'Q' + (c.q + 1) }),
      el('span', { text: c.name })
    ]));
    var img = el('img', { class: 'cstrip', alt: 'question ' + (c.q + 1) });
    Q.DB.get('blobs', c.info.blob).then(function (b) { if (b) img.src = b.data; });
    row.appendChild(img);
    row.appendChild(el('div', { class: 'cwhy' }, [
      el('span', { class: 'warnc', text: c.info.why }),
      el('span', { class: 'dim', text: 'read as ' +
        (c.info.read >= 0 ? S.LETTERS[c.info.read] : 'blank') +
        ' · key is ' + (t.mc.key[c.q] != null ? S.LETTERS[t.mc.key[c.q]] : '?') })
    ]));

    var opts = el('div', { class: 'copts' });
    for (var k = 0; k < t.mc.choices; k++) (function (k) {
      opts.appendChild(el('button', {
        class: 'opt' + (c.info.read === k ? ' on' : ''), text: S.LETTERS[k],
        title: 'Record ' + S.LETTERS[k],
        onclick: function () { setOverride(c, k); }
      }));
    })(0 + k);
    opts.appendChild(el('button', { class: 'btn sm', text: 'blank',
      onclick: function () { setOverride(c, -1); } }));
    opts.appendChild(el('button', { class: 'btn sm go', text: 'Looks right',
      onclick: function () { confirmCheck(c); } }));
    row.appendChild(opts);
    wrap.appendChild(row);
  });
  if (list.length > 40) {
    wrap.appendChild(el('p', { class: 'hint', text: 'Showing the first 40 of ' + list.length + '.' }));
  }
  wrap.appendChild(el('button', {
    class: 'btn sm', text: 'Accept all remaining as read',
    onclick: function () {
      Q.confirmBox('Accept all ' + list.length + ' flagged marks exactly as the reader saw them?',
        'Accept all').then(function (ok) {
        if (!ok) return;
        var touched = {};
        list.forEach(function (c) {
          c.scan.confirmed = c.scan.confirmed || {};
          c.scan.confirmed[c.q] = 1;
          touched[c.scan.id] = c.scan;
        });
        Promise.all(Object.keys(touched).map(function (id) { return Q.DB.put('scans', touched[id]); }))
          .then(function () { recompute(); renderReview(); });
      });
    }
  }));
  host.appendChild(wrap);
}

function setOverride(c, choice) {
  c.scan.overrides = c.scan.overrides || {};
  c.scan.overrides[c.q] = choice;
  Q.DB.put('scans', c.scan).then(function () {
    recompute(); renderReview();
    Q.toast('Q' + (c.q + 1) + ' for ' + c.name + ' recorded as ' +
      (choice >= 0 ? S.LETTERS[choice] : 'blank') + '.', 'good');
  });
}
function confirmCheck(c) {
  c.scan.confirmed = c.scan.confirmed || {};
  c.scan.confirmed[c.q] = 1;
  Q.DB.put('scans', c.scan).then(function () { recompute(); renderReview(); });
}

/* ================================================ question performance ==
 * A bad question is discovered by looking at how the class did on it, so the
 * place to fix it is the same place you see it. Every change here is a rule
 * on the test — no answers are altered and nothing is rescanned.
 */
function renderQuestionTable() {
  var host = $('#questionBox');
  host.innerHTML = '';
  var t = State.test, r = State.results;
  if (!t || !r || !t.mc.count) return;
  if (!r.scannedRows.length) return;

  var head = el('div', { class: 'row between wrap-row' }, [
    el('h2', { text: 'How the class did, question by question' }),
    el('span', { class: 'hint', text: 'Click any question to drop it, accept another ' +
      'answer, or give everyone credit.' })
  ]);
  host.appendChild(head);

  var tb = el('tbody');
  for (var q = 0; q < t.mc.count; q++) (function (q) {
    var it = r.itemPct[q] || { pct: 0, n: 0, dist: [] };
    var modified = SC.isModified(t, q);
    var pct = Math.round(it.pct * 100);
    var flag = SC.ruleFor(t, q).drop ? 'dropped'
             : it.n === 0 ? ''
             : pct < 35 ? 'hard' : pct > 97 ? 'easy' : '';

    var bar = el('div', { class: 'qbar' + (flag === 'hard' ? ' hard' : '') }, [
      el('i', { style: 'width:' + Math.max(2, pct) + '%' })
    ]);
    tb.appendChild(el('tr', { class: modified ? 'qmod' : '' }, [
      el('td', { class: 'mono', text: String(q + 1) }),
      el('td', { text: t.mc.key[q] == null ? '?' : S.LETTERS[t.mc.key[q]] }),
      el('td', {}, [bar]),
      el('td', { class: 'mono', text: it.n ? pct + '%' : '—' }),
      el('td', { class: 'dim', text: (it.dist || []).map(function (d, i) {
        return S.LETTERS[i] + ':' + d;
      }).join('  ') }),
      el('td', { class: modified ? 'warnc' : 'dim',
        text: modified ? SC.ruleSummary(t, q) : (flag === 'hard' ? 'most of the class missed this'
          : flag === 'easy' ? 'everyone got it' : '') }),
      el('td', {}, [el('button', {
        class: 'btn sm' + (modified ? ' go' : ''), text: modified ? 'Change' : 'Fix…',
        onclick: function () { fixQuestionDialog(q); }
      })])
    ]));
  })(q);

  host.appendChild(el('div', { class: 'tbl' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Q', 'Key', 'Class correct', '', 'Answers chosen', '', '']
        .map(function (h) { return el('th', { text: h }); }))]),
      tb
    ])
  ]));
}

function fixQuestionDialog(q) {
  var t = State.test;
  var rule = JSON.parse(JSON.stringify(SC.ruleFor(t, q)));
  var body = el('div', {}, [
    el('h3', { text: 'Question ' + (q + 1) }),
    el('p', { class: 'hint', text: 'Nothing is rescanned and no student answer is changed — ' +
      'this only changes how the question is scored, for everyone.' })
  ]);

  var accept = el('div', { class: 'row gap wrap-row', style: 'margin:8px 0 14px' });
  function drawAccept() {
    accept.innerHTML = '';
    for (var k = 0; k < t.mc.choices; k++) (function (k) {
      var isKey = t.mc.key[q] === k;
      var on = isKey || (rule.accept || []).indexOf(k) >= 0;
      accept.appendChild(el('button', {
        class: 'opt' + (on ? ' on' : ''), text: S.LETTERS[k],
        title: isKey ? 'The answer key' : 'Also accept ' + S.LETTERS[k],
        disabled: isKey,
        onclick: function () {
          rule.accept = rule.accept || [];
          var i = rule.accept.indexOf(k);
          if (i >= 0) rule.accept.splice(i, 1); else rule.accept.push(k);
          drawAccept();
        }
      }));
    })(k);
    accept.appendChild(el('span', { class: 'hint', style: 'margin:0',
      text: t.mc.key[q] == null ? 'No key set for this question.'
        : S.LETTERS[t.mc.key[q]] + ' is the key. Click another letter to accept it too.' }));
  }
  drawAccept();
  body.appendChild(el('label', { text: 'Answers that count as correct' }));
  body.appendChild(accept);

  var dropBox = el('input', { type: 'checkbox', checked: !!rule.drop });
  var creditBox = el('input', { type: 'checkbox', checked: !!rule.credit });
  var ptsInput = el('input', { type: 'number', step: '0.5', min: '0', style: 'width:110px',
    value: rule.points != null ? rule.points : (t.mc.points == null ? 1 : t.mc.points) });

  body.appendChild(el('label', { class: 'chk', style: 'margin:6px 0' },
    [dropBox, 'Drop this question — it stops counting for anyone, and the test is out of less']));
  body.appendChild(el('label', { class: 'chk', style: 'margin:6px 0' },
    [creditBox, 'Give everyone the points, whatever they answered']));
  body.appendChild(el('label', { style: 'margin-top:12px' }, ['Points for this question', ptsInput]));

  var preview = el('p', { class: 'hint' });
  function refresh() {
    var scratch = JSON.parse(JSON.stringify(t));
    scratch.mc.rules = Object.assign({}, SC.rulesOf(t));
    scratch.mc.rules[q] = collect();
    var n = 0;
    State.results.scannedRows.forEach(function (row) {
      var s = SC.scoreQuestion(scratch, q, row.answers[q], row.states[q]);
      if (s.earned > 0) n++;
    });
    preview.textContent = 'With this change, ' + n + ' of ' +
      State.results.scannedRows.length + ' students earn points on question ' + (q + 1) +
      '. The test would be out of ' + Q.round2(SC.mcPossible(scratch) + SC.writtenPossible(scratch)) + '.';
  }
  function collect() {
    var out = {};
    if (dropBox.checked) out.drop = true;
    if (creditBox.checked) out.credit = true;
    if (rule.accept && rule.accept.length) out.accept = rule.accept.slice();
    var p = parseFloat(ptsInput.value);
    var dflt = t.mc.points == null ? 1 : t.mc.points;
    if (isFinite(p) && p !== dflt) out.points = p;
    return out;
  }
  [dropBox, creditBox, ptsInput].forEach(function (n) { on(n, 'change', refresh); });
  on(accept, 'click', function () { setTimeout(refresh, 0); });
  refresh();
  body.appendChild(preview);

  body.appendChild(el('div', { class: 'row gap end', style: 'margin-top:16px' }, [
    el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); } }),
    el('button', { class: 'btn danger', text: 'Reset to normal',
      onclick: function () { saveRule(q, null); h.close(); } }),
    el('button', { class: 'btn go', text: 'Apply',
      onclick: function () { saveRule(q, collect()); h.close(); } })
  ]));
  var h = Q.modal(body);
}

function saveRule(q, rule) {
  var t = State.test;
  t.mc.rules = t.mc.rules || {};
  if (!rule || !Object.keys(rule).length) delete t.mc.rules[q];
  else t.mc.rules[q] = rule;
  saveTest().then(function () {
    recompute();
    renderReview();
    Q.toast(rule && Object.keys(rule).length
      ? 'Question ' + (q + 1) + ': ' + SC.ruleSummary(t, q) + '. Every score updated.'
      : 'Question ' + (q + 1) + ' back to normal scoring.', 'good', 5000);
  });
}

/* ======================================================= storage upkeep ==
 * The scanned images are much larger than the scores, and they stop being
 * useful once a test is handed back. Dropping them reclaims almost everything
 * while every answer, score and comment stays exactly as it is.
 */
function imageIdsForTest() {
  var ids = [];
  State.scans.concat(State.trash).forEach(function (sc) {
    ids = ids.concat(collectBlobIds(sc));
  });
  return ids;
}

/** Size of this test's images, estimated from a sample rather than a full read. */
function estimateImageBytes(ids) {
  if (!ids.length) return Promise.resolve(0);
  var sample = ids.slice(0, Math.min(6, ids.length));
  return Promise.all(sample.map(function (id) { return Q.DB.get('blobs', id); }))
    .then(function (rows) {
      var got = rows.filter(Boolean);
      if (!got.length) return 0;
      var avg = got.reduce(function (a, b) { return a + (b.data ? b.data.length : 0); }, 0) / got.length;
      return avg * ids.length;
    });
}
function mb(bytes) { return Math.round(bytes / 1048576 * 10) / 10; }
/** Sizes below a megabyte read as nonsense in MB, so switch units. */
function humanBytes(bytes) {
  if (bytes < 1024) return Math.round(bytes) + ' bytes';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
  return mb(bytes) + ' MB';
}

function renderStorage() {
  var host = $('#storageBox');
  if (!host) return;
  host.innerHTML = '';
  var ids = imageIdsForTest();
  if (!ids.length) return;

  var line = el('span', { text: 'Working out how much space this test uses…' });
  host.appendChild(el('div', { class: 'trashbar' }, [line]));

  estimateImageBytes(ids).then(function (bytes) {
    var bar = host.firstChild;
    bar.innerHTML = '';
    /* Say nothing at all until this is worth a teacher's attention. */
    if (bytes < 25 * 1048576) {
      bar.className = 'hint';
      bar.textContent = ids.length + ' scanned image' + (ids.length === 1 ? '' : 's') +
        ' kept for this test, about ' + humanBytes(bytes) + '.';
      bar.appendChild(el('button', { class: 'btn sm', style: 'margin-left:10px',
        text: 'Free up the space', onclick: freeUp }));
      return;
    }
    bar.appendChild(el('span', { html: 'This test is holding <b>' + ids.length +
      '</b> scanned image' + (ids.length === 1 ? '' : 's') + ', about <b>' + humanBytes(bytes) +
      '</b>. They are only needed while you are reviewing and grading.' }));
    bar.appendChild(el('button', { class: 'btn sm', text: 'Free up the space', onclick: freeUp }));

    function freeUp() {
        Q.confirmBox('Remove ' + ids.length + ' scanned image(s), about ' + humanBytes(bytes) + '?\n\nEvery score, answer, written mark and comment is kept. You will no ' +
          'longer be able to look at the scanned paper for this test.',
          'Remove the images').then(function (ok) {
          if (!ok) return;
          Q.DB.delMany('blobs', ids).then(function () {
            State.scans.concat(State.trash).forEach(function (sc) {
              sc.nameCrop = null; sc.classCrop = null; sc.pageImg = null;
              sc.written = {}; sc.checks = {};
            });
            return Q.DB.putMany('scans', State.scans.concat(State.trash));
          }).then(function () {
            recompute(); renderReview();
            Q.toast('Freed about ' + humanBytes(bytes) + '. All scores kept.', 'good', 6000);
          });
        });
    }
  });
}

/** Whole-browser usage, for the Tests screen. */
function renderStorageTotal() {
  var host = $('#storageTotal');
  if (!host) return;
  host.textContent = '';
  if (!navigator.storage || !navigator.storage.estimate) return;
  navigator.storage.estimate().then(function (e) {
    if (!e || !e.quota) return;
    var pct = Math.round(e.usage / e.quota * 100);
    host.textContent = 'Using ' + humanBytes(e.usage) + ' of the ' +
      Math.round(e.quota / 1073741824 * 10) / 10 + ' GB this browser allows' +
      (pct >= 1 ? ' (' + pct + '%)' : '') + '.';
    if (pct > 70) host.className = 'hint warnc';
  });
}

/* ---- name contact sheet: catches a student using someone else's sheet ---- */
function verifyNames() {
  var body = el('div', {}, [
    el('h3', { text: 'Check the handwriting against the name we filed it under' }),
    el('p', { class: 'hint', text: 'A student who picks up the wrong pre-printed sheet is filed under ' +
      'the printed ID, not the name they wrote. This is the only way to catch that. ' +
      'Anything that does not match, click to reassign.' })
  ]);
  var grid = el('div', { class: 'namegrid' });
  var seen = {}, n = 0;
  State.scans.slice()
    .sort(function (a, b) { return Q.sortName(studentName(a.sid)).localeCompare(Q.sortName(studentName(b.sid))); })
    .forEach(function (sc) {
      if (!sc.nameCrop || seen[sc.sid || sc.id]) return;
      seen[sc.sid || sc.id] = 1; n++;
      var cell = el('div', { class: 'namecell' });
      var img = el('img', { alt: 'handwritten name' });
      Q.DB.get('blobs', sc.nameCrop).then(function (b) { if (b) img.src = b.data; });
      cell.appendChild(img);
      cell.appendChild(el('b', { text: sc.sid ? studentName(sc.sid) : 'unassigned' }));
      var sel = el('select', { class: 'sel sm' }, [el('option', { value: '' }, 'reassign…')].concat(
        classStudents().map(function (s) { return el('option', { value: s.sid }, s.name); })));
      on(sel, 'change', function () {
        if (!sel.value) return;
        var mine = State.scans.filter(function (x) { return S.normId(x.sid) === S.normId(sc.sid); });
        Promise.all(mine.map(function (x) { return assignScan(x, sel.value, true); }))
          .then(function () { h.close(); renderReview(); Q.toast('Reassigned.', 'good'); });
      });
      cell.appendChild(sel);
      grid.appendChild(cell);
    });
  if (!n) body.appendChild(el('p', { class: 'hint', text: 'No scanned name images yet.' }));
  body.appendChild(grid);
  var h = Q.modal(body);
}

function assignScan(sc, sid, quiet) {
  var dup = State.scans.filter(function (s) { return S.normId(s.sid) === S.normId(sid) && s.page === sc.page && s.id !== sc.id; })[0];
  var chain = dup ? deleteScan(dup) : Promise.resolve();
  return chain.then(function () {
    sc.sid = S.normId(sid);
    sc.flags = (sc.flags || []).filter(function (f) { return f !== 'no-id' && f !== 'partial-id'; });
    return Q.DB.put('scans', sc);
  }).then(function () {
    recompute();
    if (quiet) return;
    renderReview();
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
  var mine = State.scans.filter(function (s) { return S.normId(s.sid) === S.normId(x.sid); })
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

  /* A rubric replaces the points strip with one row per criterion. Digits
   * fill the next unmarked criterion, so "2 1 3" marks the whole thing. */
  var rubric = SC.rubricOf(t, GState.qIdx);
  if (rubric) {
    var chosen = (rec.r || []).slice();
    var grid = el('div', { class: 'rubgrid' });
    rubric.criteria.forEach(function (cName, ci) {
      var line = el('div', { class: 'rubrow' }, [el('span', { class: 'rubname', text: cName })]);
      rubric.levels.forEach(function (lv, li) {
        line.appendChild(el('button', {
          class: 'pbtn rub' + (chosen[ci] === li ? ' on' : '') + (lv.pts === 0 ? ' zero' : ''),
          html: '<b>' + Q.esc(lv.label) + '</b><span>' + lv.pts + '</span>',
          onclick: function () { setRubricLevel(ci, li); }
        }));
      });
      grid.appendChild(line);
    });
    var earned = SC.rubricScore(rubric, chosen);
    var done = SC.rubricComplete(rubric, chosen);
    grid.appendChild(el('div', { class: 'rubtotal' + (done ? ' done' : '') }, [
      el('b', { text: earned + ' / ' + SC.rubricMax(rubric) }),
      el('span', { class: 'hint', style: 'margin:0',
        text: done ? 'complete — press Enter for the next student'
                   : 'press 1–' + rubric.levels.length + ' to mark the next criterion' })
    ]));
    row.appendChild(grid);
    row.appendChild(el('button', { class: 'btn sm', text: 'skip',
      onclick: function () { move(1); } }));
    renderQuickComments();
    return;
  }
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

  renderQuickComments();
}

/** Shared by the plain points strip and the rubric grid. */
function renderQuickComments() {
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

/** Mark one criterion; when the last one is filled the score is saved. */
function setRubricLevel(ci, li) {
  var t = State.test, item = GState.list[GState.pos];
  if (!item) return;
  var rubric = SC.rubricOf(t, GState.qIdx);
  if (!rubric) return;
  var g = State.grades[item.sid] || (State.grades[item.sid] = {});
  g.w = g.w || {};
  var recNow = g.w[GState.qIdx] || (g.w[GState.qIdx] = {});
  recNow.r = (recNow.r || []).slice();
  recNow.r[ci] = li;
  recNow.p = SC.rubricScore(rubric, recNow.r);
  recNow.c = $('#gradeComment').value.trim();
  var complete = SC.rubricComplete(rubric, recNow.r);
  saveGrades().then(function () {
    recompute();
    if (complete && Q.Prefs.get('rubricAuto', true)) move(1);
    else showGradeItem();
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
  var rubricNow = SC.rubricOf(t, GState.qIdx);
  if (rubricNow && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    var li = parseInt(e.key, 10) - 1;
    if (li >= rubricNow.levels.length) return;
    var itemNow = GState.list[GState.pos];
    var recR = ((State.grades[(itemNow || {}).sid] || {}).w || {})[GState.qIdx] || {};
    var have = (recR.r || []);
    var next = 0;
    while (next < rubricNow.criteria.length && have[next] != null) next++;
    if (next >= rubricNow.criteria.length) next = rubricNow.criteria.length - 1;
    setRubricLevel(next, li);
    return;
  }
  if (rubricNow && (e.key === 'Backspace' || e.key === 'Delete')) {
    e.preventDefault();
    var it2 = GState.list[GState.pos];
    var g2 = State.grades[(it2 || {}).sid];
    var r2 = g2 && g2.w && g2.w[GState.qIdx];
    if (r2 && r2.r && r2.r.length) {
      var last = r2.r.length - 1;
      while (last >= 0 && r2.r[last] == null) last--;
      if (last >= 0) {
        r2.r[last] = null;
        r2.p = SC.rubricScore(rubricNow, r2.r);
        saveGrades().then(function () { recompute(); showGradeItem(); });
      }
    }
    return;
  }
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

  var mastery = null;
  if (Q.Mastery.isTagged(t)) {
    var stds = Q.Mastery.standardsOf(t);
    var head = ['Student', 'Student ID'];
    stds.forEach(function (sd) { head.push(sd.name + ' %'); });
    head.push('Weakest objective');
    mastery = [head.map(function (hh) { return { v: hh, s: X.XS.HEADER }; })];
    r.rows.forEach(function (x) {
      if (!x.scanned) return;
      var mine = Q.Mastery.forStudent(t, x);
      var row = [x.name, x.sid];
      var worst = null;
      stds.forEach(function (sd) {
        var m = mine.filter(function (z) { return z.name === sd.name; })[0];
        row.push(m ? { v: m.pct, s: X.XS.PCT } : '');
        if (m && (!worst || m.pct < worst.pct)) worst = m;
      });
      row.push(worst && worst.level.id !== 'secure' ? worst.name : '');
      mastery.push(row);
    });
    var classRow = [{ v: 'CLASS', s: X.XS.BOLD }, ''];
    Q.Mastery.forClass(t, r);
    stds.forEach(function (sd) {
      var cs = Q.Mastery.forClass(t, r).filter(function (z) { return z.name === sd.name; })[0];
      classRow.push(cs ? { v: cs.pct, s: X.XS.PCT } : '');
    });
    classRow.push('');
    mastery.splice(1, 0, classRow);
  }

  var sheets = [
    { name: 'Item analysis', rows: rows, cols: [10, 14, 14, 11, 13, 8, 15], freezeHeader: true },
    { name: 'Raw responses', rows: responses, cols: [26, 12], freezeHeader: true, autoFilter: true }
  ];
  if (t.written.length) sheets.push({ name: 'Written answers', rows: written, cols: [26, 12, 28, 9, 8, 46], freezeHeader: true });
  if (mastery) sheets.push({ name: 'Mastery', rows: mastery, cols: [26, 12], freezeHeader: true, autoFilter: true });

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
      var rub = SC.rubricOf(t, wi);
      if (rub && rec.r) {
        rub.criteria.forEach(function (cName, ci) {
          var lv = rec.r[ci] == null ? null : rub.levels[rec.r[ci]];
          wbody.push([
            { text: '' },
            { text: '· ' + cName, size: 9, color: '5B6577' },
            { text: lv ? lv.label + ' (' + lv.pts + ')' : '—', align: 'center', size: 9,
              color: lv && lv.pts === 0 ? 'B3261E' : '5B6577' }
          ].concat(ts.showWrittenNotes ? [{ text: '' }] : []));
        });
      }
    });
    out += T(wbody, { header: true, widths: ww });
    if (t.written.some(function (w) { return w.expected; })) {
      out += P('Expected answers', { style: 'Heading2' });
      t.written.forEach(function (wq, wi) {
        if (wq.expected) out += P((wi + 1) + '. ' + wq.expected, { size: 10 });
      });
    }
  }

  /* What to revise, rather than only what was scored. */
  if (ts.showMastery && Q.Mastery.isTagged(t)) {
    var mine = Q.Mastery.forStudent(t, x);
    if (mine.length) {
      out += P('What you have and haven’t got', { style: 'Heading2' });
      out += T([[{ text: 'Topic' }, { text: 'Right' }, { text: 'Out of' }, { text: 'Level' }]]
        .concat(mine.map(function (m) {
          return [
            { text: m.name, size: 10 },
            { text: String(m.correct), align: 'center' },
            { text: String(m.counted), align: 'center' },
            { text: m.level.label, align: 'center', b: true,
              color: m.level.id === 'secure' ? '1A7F4B' : m.level.id === 'developing' ? '8A5A00' : 'B3261E' }
          ];
        })), { header: true, widths: [0.52, 0.14, 0.14, 0.2] });
      var weak = mine.filter(function (m) { return m.level.id !== 'secure'; });
      if (weak.length) {
        out += P('Worth another look: ' + weak.map(function (m) { return m.name; }).join(', ') + '.',
          { size: 10, color: '8A5A00', spaceAfter: 140 });
      }
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
    if (ts.showMastery && Q.Mastery.isTagged(t)) {
      var mine = Q.Mastery.forStudent(t, x);
      if (mine.length) {
        h += '<h2>What you have and haven’t got</h2><table><tr><th>Topic</th>' +
          '<th class="c">Right</th><th class="c">Out of</th><th class="c">Level</th></tr>';
        mine.forEach(function (m) {
          h += '<tr><td>' + X.xml(m.name) + '</td><td class="c">' + m.correct +
            '</td><td class="c">' + m.counted + '</td><td class="c ' +
            (m.level.id === 'secure' ? 'ok' : 'no') + '">' + m.level.label + '</td></tr>';
        });
        h += '</table>';
      }
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

/* ==================================================== export formats ====
 * The teacher picks their gradebook once and never thinks about it again.
 * Everything below the fold exists so that when a gradebook wants something
 * odd, nobody has to wait for us to ship a new version.
 */
function savedFormats() { return Q.Prefs.get('formats', []); }
function allFormats() { return X2.PRESETS.concat(savedFormats()); }
function currentFormat() {
  var id = Q.Prefs.get('formatId', 'simple');
  var f = allFormats().filter(function (x) { return x.id === id; })[0];
  return JSON.parse(JSON.stringify(f || X2.PRESETS[1]));
}
var workingFmt = null;
function fmt() { return workingFmt || (workingFmt = currentFormat()); }

function exportCtx() {
  recompute();
  return { test: State.test, results: State.results, byId: State.byId };
}

function renderFormatUI() {
  var f = fmt();
  var pick = $('#fmtPick');
  pick.innerHTML = '';
  allFormats().forEach(function (p) {
    pick.appendChild(el('option', { value: p.id, selected: p.id === f.id }, p.name));
  });
  $('#fmtNote').textContent = f.note || 'Your own saved layout.';
  $('#fmtDelete').hidden = !savedFormats().some(function (p) { return p.id === f.id; });

  var add = $('#fmtAdd');
  add.innerHTML = '';
  var lastGroup = '';
  X2.FIELDS.forEach(function (fl) {
    if (fl.g !== lastGroup) { lastGroup = fl.g; add.appendChild(el('option', { disabled: true }, '— ' + fl.g + ' —')); }
    add.appendChild(el('option', { value: fl.key }, fl.label));
  });

  var host = $('#fmtCols');
  host.innerHTML = '';
  (f.cols || []).forEach(function (key, i) {
    var fl = X2.FIELD_BY_KEY[key];
    if (!fl) return;
    var row = el('div', { class: 'fmtcol' + (fl.expand ? ' multi' : '') });
    row.appendChild(el('span', { class: 'fname', text: fl.label }));
    if (!fl.expand) {
      row.appendChild(el('input', {
        value: (f.heads || {})[key] || fl.head, 'aria-label': 'Heading for ' + fl.label,
        oninput: function (e) {
          f.heads = f.heads || {};
          f.heads[key] = e.target.value;
          renderPreview();
        }
      }));
    } else {
      row.appendChild(el('span', { class: 'hint', style: 'flex:1;margin:0' }));
    }
    row.appendChild(el('button', { class: 'btn', text: '↑', title: 'Move up', disabled: i === 0,
      onclick: function () { f.cols.splice(i - 1, 0, f.cols.splice(i, 1)[0]); renderFormatUI(); } }));
    row.appendChild(el('button', { class: 'btn', text: '↓', title: 'Move down',
      disabled: i === f.cols.length - 1,
      onclick: function () { f.cols.splice(i + 1, 0, f.cols.splice(i, 1)[0]); renderFormatUI(); } }));
    row.appendChild(el('button', { class: 'btn danger', text: '×', title: 'Remove column',
      onclick: function () { f.cols.splice(i, 1); renderFormatUI(); } }));
    host.appendChild(row);
  });
  renderPreview();
}

function renderPreview() {
  var host = $('#fmtPreview');
  host.innerHTML = '';
  if (!State.test) return;
  var built;
  try { built = X2.buildRows(fmt(), exportCtx(), { onlyScanned: $('#fmtOnlyScanned').checked }); }
  catch (e) { host.appendChild(el('p', { class: 'hint', text: 'Preview unavailable: ' + e.message })); return; }
  var tb = el('tbody');
  built.rows.slice(0, 4).forEach(function (r) {
    tb.appendChild(el('tr', {}, r.map(function (v) { return el('td', { text: String(v) }); })));
  });
  if (!built.rows.length) tb.appendChild(el('tr', {}, [el('td', { class: 'dim', text: 'No rows yet.' })]));
  host.appendChild(el('table', {}, [
    el('thead', {}, [el('tr', {}, built.head.map(function (h) { return el('th', { text: h }); }))]), tb
  ]));
  if (built.rows.length > 4) {
    host.appendChild(el('p', { class: 'hint', style: 'padding:6px 10px;margin:0',
      text: 'Showing 4 of ' + built.rows.length + ' rows.' }));
  }
}

function exportGradebookMapped(kind) {
  if (!State.test) { Q.toast('Select a test first.', 'err'); return; }
  var ctx = exportCtx();
  var built = X2.buildRows(fmt(), ctx, { onlyScanned: $('#fmtOnlyScanned').checked });
  if (!built.rows.length) { Q.toast('Nothing to export yet — scan some sheets first.', 'err'); return; }
  var rows = [built.head].concat(built.rows);

  if (kind === 'tsv') {
    Q.copyToClipboard(X.toTsv(rows)).then(function () {
      Q.toast('Copied. Open your sheet, click the first cell, and paste.', 'good', 6000);
    }).catch(function () { Q.toast('The browser blocked the clipboard — use the .csv download.', 'err'); });
    return;
  }
  if (kind === 'csv') {
    Q.downloadText(X.toCsv(rows), fileBase() + '_gradebook.csv', 'text/csv');
    Q.toast('CSV saved.', 'good');
    return;
  }
  var head = built.head.map(function (h) { return { v: h, s: X.XS.HEADER }; });
  var widths = built.head.map(function (h) { return Math.min(30, Math.max(9, String(h).length + 3)); });
  Q.downloadBlob(X.buildXlsx([{ name: 'Grades', rows: [head].concat(built.rows),
    cols: widths, freezeHeader: true, autoFilter: true }]), fileBase() + '_gradebook.xlsx');
  Q.toast('Saved. Import it from your gradebook’s upload screen.', 'good', 6000);
}

/* Optional, and deliberately out of the way: post the same rows to a web
 * address. For a district that already has somewhere to receive them. */
function sendToEndpoint() {
  var url = Q.Prefs.get('endpoint', '');
  var body = el('div', {}, [
    el('h3', { text: 'Send scores to a web address' }),
    el('p', { class: 'hint', text: 'Optional, and not needed for normal use — the download and ' +
      'the paste-into-Sheets button cover almost everyone. This is here for a school that already ' +
      'has somewhere to receive results automatically.' })
  ]);
  var inp = el('input', { value: url, placeholder: 'https://…', 'aria-label': 'Web address' });
  body.appendChild(el('label', {}, ['Web address to send to', inp]));
  body.appendChild(el('p', { class: 'hint', text: 'QuickGrade will POST the same rows you see ' +
    'in the preview, as JSON. Ask whoever runs the receiving end for the address — do not paste ' +
    'one you were sent by someone you do not know.' }));

  var out = el('p', { class: 'hint' });
  body.appendChild(el('div', { class: 'row gap end', style: 'margin-top:14px' }, [
    el('button', { class: 'btn', text: 'Close', onclick: function () { h.close(); } }),
    el('button', {
      class: 'btn go', text: 'Save and send',
      onclick: function () {
        var u = inp.value.trim();
        if (!/^https:\/\//i.test(u)) { out.textContent = 'Use an https:// address.'; return; }
        Q.Prefs.set('endpoint', u);
        var payload = X2.buildPayload(fmt(), exportCtx(), { onlyScanned: $('#fmtOnlyScanned').checked });
        out.textContent = 'Sending ' + payload.rows.length + ' row(s)…';
        /* text/plain keeps this a simple request, so no CORS preflight is
         * needed against endpoints that do not handle OPTIONS. */
        fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                   body: JSON.stringify(payload) })
          .then(function (r) { out.textContent = r.ok ? 'Sent — the address accepted it.'
                                                      : 'Sent, but it replied ' + r.status + '.'; })
          .catch(function () {
            return fetch(u, { method: 'POST', mode: 'no-cors',
                              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                              body: JSON.stringify(payload) })
              .then(function () { out.textContent = 'Sent. The address did not reply in a way we ' +
                'can read, so check on that end that it arrived.'; })
              .catch(function (e) { out.textContent = 'Could not reach that address: ' + e.message; });
          });
      }
    })
  ]));
  body.appendChild(out);
  var h = Q.modal(body);
}

/* A curve is applied to the class as a whole, so it lives with the grading
 * scale rather than on any individual question. */
function renderCurve() {
  var host = $('#curveBox');
  if (!host) return;
  host.innerHTML = '';
  var t = State.test;
  var c = t.curve || (t.curve = { kind: 'none', value: 0 });

  var kind = el('select', { class: 'sel', 'aria-label': 'Curve' },
    SC.CURVES.map(function (x) {
      return el('option', { value: x.id, selected: x.id === c.kind }, x.label);
    }));
  var val = el('input', { type: 'number', step: '0.5', value: c.value || 0,
    style: 'width:90px', 'aria-label': 'Curve amount' });
  var unit = el('span', { class: 'hint', style: 'margin:0' });
  var note = el('p', { class: 'hint' });

  function sync() {
    var def = SC.CURVES.filter(function (x) { return x.id === kind.value; })[0] || {};
    val.hidden = !def.unit;
    unit.textContent = def.unit || '';
    var r = State.results;
    if (kind.value === 'none' || !r || !r.scannedRows.length) { note.textContent = ''; return; }
    var lifted = r.rows.filter(function (x) { return x.scanned && x.curved; }).length;
    var avg = r.scannedRows.length
      ? Math.round(r.scannedRows.reduce(function (a, x) { return a + x.pct; }, 0) / r.scannedRows.length * 100)
      : 0;
    note.textContent = lifted + ' of ' + r.scannedRows.length +
      ' scores changed. Class average is now ' + avg + '%. ' +
      'The uncurved score is kept, so you can undo this at any time.';
  }
  function apply() {
    t.curve = { kind: kind.value, value: parseFloat(val.value) || 0 };
    saveTest().then(function () { recompute(); renderCurve(); renderPreview(); });
  }
  on(kind, 'change', function () { sync(); apply(); });
  on(val, 'change', apply);

  host.appendChild(el('div', { class: 'row gap wrap-row' }, [kind, val, unit]));
  host.appendChild(note);
  sync();
}

function renderExport() {
  recompute();
  if (!State.test) return;
  renderFormatUI();
  renderCurve();
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
    Q.Prefs.set('lastBackup', Date.now());
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
  on($('#btnDemo'), 'click', function (e) { loadSampleClass(e.target); });
  on($('#btnCancelTest'), 'click', closeEditor);
  on($('#btnKeyClear'), 'click', function () { editing.mc.key = []; renderKeyGrid(); });
  /* wrapped: the click event would otherwise arrive as the onApply callback */
  on($('#btnKeyPaste'), 'click', function () { pasteKeyDialog(); });
  on($('#btnPasteTopics'), 'click', function () {
    if (!editing.mc.count) { Q.toast('Set the number of questions first.', 'err'); return; }
    pasteTopicsDialog();
  });
  on($('#btnWrittenPaste'), 'click', pasteWrittenDialog);
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
  on($('#rosterClass'), 'input', renderRosterTable);
  on($('#rosterClass'), 'change', renderRosterTable);
  on($('#btnRosterSave'), 'click', saveRosterPaste);
  on($('#btnRosterImport'), 'click', function () { $('#rosterFile').click(); });
  on($('#rosterFile'), 'change', function (e) {
    if (e.target.files[0]) importRosterCsv(e.target.files[0]);
    e.target.value = '';
  });
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
    var rows = [['Name', 'Student ID', 'Class', 'Email']].concat(
      State.students.filter(function (s) { return s.cls === cls; })
        .sort(function (a, b) { return Q.sortName(a.name).localeCompare(Q.sortName(b.name)); })
        .map(function (s) { return [s.name, s.sid, s.cls, s.email || '']; }));
    Q.downloadText(X.toCsv(rows), 'roster_' + (cls || 'class').replace(/\W+/g, '_') + '.csv', 'text/csv');
  });
  /* The picker only exists when a test has more than one version. */
  function chosenForm() {
    var sel = $('#printForm');
    return sel && !sel.hidden ? sel.value : null;
  }
  on($('#btnPrintPersonal'), 'click', function () { printSheets('personal', chosenForm()); });
  on($('#btnPrintBlank'), 'click', function () { printSheets('blank', chosenForm()); });
  on($('#btnPrintKey'), 'click', function () { printSheets('key', chosenForm()); });

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
  on($('#btnCalibrate'), 'click', function () {
    if (!Scanner.running) { Q.toast('Start the camera first.', 'err'); return; }
    Scanner.startCalibration();
  });
  on($('#btnPrintCheck'), 'click', function () {
    route('scan');
    Q.toast('Start the camera, then hold up one printed blank sheet.', 'good', 6000);
    setTimeout(function () { if (Scanner.running) Scanner.startCalibration(); }, 400);
  });
  on($('#photoInput'), 'change', function (e) {
    if (e.target.files && e.target.files.length) Scanner.importFiles(e.target.files);
    e.target.value = '';
  });

  /* review */
  on($('#showMissingOnly'), 'change', renderReview);
  on($('#btnVerifyNames'), 'click', verifyNames);
  on($('#btnClearScans'), 'click', function () {
    var mine = State.scans.slice();
    if (!mine.length) { Q.toast('There are no scans to delete.', 'err'); return; }
    Q.confirmBox('Delete all ' + mine.length + ' scanned sheet(s) for "' + State.test.title +
      '"? You can bring them back afterwards. Grades you typed are kept.',
      'Delete ' + mine.length + ' sheet(s)').then(function (ok) {
      if (!ok) return;
      mine.forEach(function (sc) { sc.deleted = Date.now(); });
      Q.DB.putMany('scans', mine).then(function () {
        State.scans = [];
        State.trash = State.trash.concat(mine);
        Scanner.resetSession(); recompute(); renderReview();
        Q.toast('Deleted ' + mine.length + ' sheet(s).', 'good', 9000, {
          label: 'Undo',
          fn: function () { restoreScans(mine).then(function () { renderReview(); }); }
        });
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
  on($('#exXlsx'), 'click', function () { exportGradebookMapped('xlsx'); });
  on($('#exCsv'), 'click', function () { exportGradebookMapped('csv'); });
  on($('#exTsv'), 'click', function () { exportGradebookMapped('tsv'); });
  on($('#fmtPick'), 'change', function (e) {
    Q.Prefs.set('formatId', e.target.value); workingFmt = null; renderFormatUI();
  });
  on($('#fmtOnlyScanned'), 'change', renderPreview);
  on($('#fmtAddBtn'), 'click', function () {
    var k = $('#fmtAdd').value;
    if (!k) return;
    var f = fmt();
    if (f.cols.indexOf(k) >= 0) { Q.toast('That column is already in the layout.', 'err'); return; }
    f.cols.push(k); renderFormatUI();
  });
  on($('#fmtReset'), 'click', function () { workingFmt = null; renderFormatUI(); });
  on($('#fmtSave'), 'click', function () {
    Q.promptBox('Name this layout', (fmt().name || '') + ' (mine)').then(function (name) {
      if (!name) return;
      var f = fmt();
      var saved = savedFormats();
      var copy = JSON.parse(JSON.stringify(f));
      copy.id = Q.uid('fmt'); copy.name = name; copy.note = 'Your own saved layout.';
      saved.push(copy);
      Q.Prefs.set('formats', saved);
      Q.Prefs.set('formatId', copy.id);
      workingFmt = null; renderFormatUI();
      Q.toast('Saved. It will be picked automatically from now on.', 'good', 5000);
    });
  });
  on($('#fmtDelete'), 'click', function () {
    var id = fmt().id;
    Q.Prefs.set('formats', savedFormats().filter(function (p) { return p.id !== id; }));
    Q.Prefs.set('formatId', 'simple');
    workingFmt = null; renderFormatUI();
  });
  on($('#exSend'), 'click', sendToEndpoint);

  on($('#exDocx'), 'click', function () { recompute(); exportTopSheetsDocx(); });
  on($('#exPrintSheets'), 'click', function () { recompute(); printTopSheets(); });
  on($('#exRawXlsx'), 'click', function () { recompute(); exportItemAnalysisXlsx(); });
  on($('#exJson'), 'click', function () { exportBackup(true); });

  /* Stop the camera when the tab is hidden so the phone does not cook. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && Scanner.running) Scanner.stop();
  });
}

global.QG.App = {
  State: State, route: route, recompute: recompute, selectTest: selectTest,
  /* internals the headless test suites drive directly */
  __test: { deleteScan: deleteScan, restoreScans: restoreScans, purgeScans: purgeScans,
            saveRule: saveRule, letterFor: letterFor }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})(window);
