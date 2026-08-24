/* Tagging questions with what they test turns a percentage into "reteach
 * Transport on Monday". Covers the parser, the maths, and every place it
 * surfaces. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const out = await page.evaluate(async () => {
    const res = {}; const ok = (n, c, d) => res[n] = { pass: !!c, d };
    const P = QG.Parse, M = QG.Mastery, SC = QG.Scoring;

    // ---------------- the shapes a teacher already has ----------------
    const named = P.parseTopics('Cells: 1-3\nTransport: 4-6', 6);
    ok('"name: range" is understood',
      named.topics.join('|') === 'Cells|Cells|Cells|Transport|Transport|Transport',
      named.topics.join('|'));
    const ranged = P.parseTopics('1-3 Cells\n4-6 Transport', 6);
    ok('"range name" is understood too', ranged.topics.join('|') === named.topics.join('|'));
    const listed = P.parseTopics('Cells: 1,2,5\nTransport: 3,4,6', 6);
    ok('comma lists are understood',
      listed.topics.join('|') === 'Cells|Cells|Transport|Transport|Cells|Transport',
      listed.topics.join('|'));
    const numbered = P.parseTopics('1. Cells\n2. Cells\n3. Transport', 3);
    ok('a plain numbered list works', numbered.topics.join('|') === 'Cells|Cells|Transport');
    const positional = P.parseTopics('Cells\nCells\nTransport', 3);
    ok('bare lines are taken in question order',
      positional.topics.join('|') === 'Cells|Cells|Transport' && positional.mode === 'one per line');
    const short = P.parseTopics('Cells\nCells', 5);
    ok('too few lines is reported, not padded silently',
      short.assigned === 2 && short.warnings.length > 0, short.warnings[0]);
    const over = P.parseTopics('Cells: 1-99', 4);
    ok('numbers past the end of the test are ignored',
      over.topics.length === 4 && over.topics.every(t => t === 'Cells'));

    // ---------------- a real test ----------------
    const T = {
      id: 'mast', title: 'Biology Unit 4', className: 'Bio', date: '2026-08-24', code: '410',
      formLabel: 'A', forms: [],
      mc: { count: 9, choices: 4, key: [0,1,2,0,1,2,0,1,2], points: 1, text: [],
            topic: ['Cells','Cells','Cells','Transport','Transport','Transport','Energy','Energy','Energy'],
            rules: {} },
      written: [], curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[90,'A'],[80,'B'],[70,'C'],[0,'F']], footer: '', topsheet: {},
        mastery: { secure: 80, developing: 60 } },
      createdAt: 6
    };
    const studs = [
      { sid: '41', name: 'Eve Marsh', cls: 'Bio' },
      { sid: '42', name: 'Fay Ortiz', cls: 'Bio' },
      { sid: '43', name: 'Gus Pike', cls: 'Bio' }
    ];
    await QG.DB.put('tests', T);
    await QG.DB.putMany('students', studs);
    QG.App.State.students = await QG.DB.all('students');
    await QG.App.selectTest(T);
    const St = QG.App.State;

    ok('the test knows its three objectives', M.standardsOf(St.test).length === 3,
      M.standardsOf(St.test).map(s => s.name + '(' + s.questions.length + ')').join(' '));

    // Everyone aces Cells. Everyone fails Transport. Energy is mixed.
    const answer = (i) => {
      const a = {};
      for (let q = 0; q < 9; q++) {
        if (q < 3) a[q] = T.mc.key[q];                       // Cells: right
        else if (q < 6) a[q] = (T.mc.key[q] + 1) % 4;        // Transport: wrong
        else a[q] = i === 0 ? T.mc.key[q] : (T.mc.key[q] + 1) % 4;  // Energy: only Eve
      }
      return a;
    };
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const files = [];
    for (let i = 0; i < studs.length; i++) {
      const sheet = Sy.renderSynthetic(St.test, 0, { sid: studs[i].sid, name: studs[i].name, answers: answer(i) });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, studs[i].sid + '.jpg'));
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();
    const row = n => St.results.rows.find(r => r.name === n);
    ok('all three sheets scanned', St.scans.length === 3, St.scans.length);

    // ---------------- per student ----------------
    const eve = M.forStudent(St.test, row('Eve Marsh'));
    const get = (list, n) => list.filter(s => s.name === n)[0];
    ok('a student is scored per objective, not just overall',
      get(eve, 'Cells').pct === 1 && get(eve, 'Transport').pct === 0 && get(eve, 'Energy').pct === 1,
      eve.map(s => s.name + ' ' + Math.round(s.pct * 100) + '%').join(', '));
    ok('levels come out of the thresholds',
      get(eve, 'Cells').level.id === 'secure' && get(eve, 'Transport').level.id === 'notyet');
    const gus = M.forStudent(St.test, row('Gus Pike'));
    ok('a weaker student differs on the right objective',
      get(gus, 'Cells').level.id === 'secure' && get(gus, 'Energy').level.id === 'notyet',
      gus.map(s => s.name + ':' + s.level.id).join(' '));

    // ---------------- per class, weakest first ----------------
    const cls = M.forClass(St.test, St.results);
    ok('the class view is sorted weakest first', cls[0].name === 'Transport',
      cls.map(s => s.name + ' ' + Math.round(s.pct * 100) + '%').join(' | '));
    ok('it counts how many students sit at each level',
      cls[0].notyet === 3 && cls[0].secure === 0,
      cls[0].notyet + ' not yet, ' + cls[0].secure + ' secure');
    ok('it says the one thing worth acting on',
      /Transport/.test(M.classHeadline(St.test, St.results)),
      M.classHeadline(St.test, St.results));

    // ---------------- interaction with rescoring ----------------
    St.test.mc.rules = { 3: { drop: true }, 4: { drop: true }, 5: { drop: true } };
    await QG.DB.put('tests', St.test);
    QG.App.recompute();
    const afterDrop = M.forStudent(St.test, row('Eve Marsh'));
    ok('dropping every question of an objective removes it, rather than showing 0%',
      !get(afterDrop, 'Transport'), afterDrop.map(s => s.name).join(', '));
    St.test.mc.rules = {};
    await QG.DB.put('tests', St.test);
    QG.App.recompute();

    // ---------------- where it surfaces ----------------
    QG.App.route('review');
    await new Promise(r => setTimeout(r, 500));
    const mrows = document.querySelectorAll('#masteryBox tbody tr');
    ok('Review shows the class breakdown', mrows.length === 3, mrows.length + ' objectives');
    ok('the weakest objective is at the top',
      mrows.length && /Transport/.test(mrows[0].textContent), mrows.length ? mrows[0].textContent.slice(0, 30) : '');

    St.test.options.topsheet.showMastery = true;
    await QG.DB.put('tests', St.test);
    QG.App.recompute();
    const orig = QG.downloadBlob; let docx = null;
    QG.downloadBlob = (b) => { docx = b; };
    QG.App.route('export');
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('exDocx').click();
    await new Promise(r => setTimeout(r, 700));
    QG.downloadBlob = orig;
    ok('the graded sheet a student gets back includes it', !!docx && docx.size > 2000,
      docx ? Math.round(docx.size / 1024) + ' KB' : 'nothing');

    let wb = null;
    QG.downloadBlob = (b) => { wb = b; };
    document.getElementById('exRawXlsx').click();
    await new Promise(r => setTimeout(r, 700));
    QG.downloadBlob = orig;
    ok('the workbook gains a mastery sheet', !!wb && wb.size > 2000,
      wb ? Math.round(wb.size / 1024) + ' KB' : 'nothing');
    return res;
  });

  for (const [k, v] of Object.entries(out)) {
    console.log((v.pass ? 'PASS  ' : 'FAIL  ') + k + (v.d != null ? '  — ' + v.d : ''));
  }
  const bad = Object.values(out).filter(v => !v.pass).length;
  console.log('\n' + (bad ? bad + ' FAILED' : 'all ' + Object.keys(out).length + ' passed'));
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
