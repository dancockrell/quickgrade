/* Scoring is the one place a quiet bug changes a real student's grade, so
 * every rule is checked in isolation and then again through the whole app. */
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
    const SC = QG.Scoring, ST = SC.STATUS;

    function mk(rules, points) {
      return { id: 'sc', title: 'Scoring', className: 'S', date: '2026-08-23', code: '555',
        mc: { count: 4, choices: 5, key: [0, 1, 2, 3], points: points == null ? 1 : points,
              text: [], topic: [], rules: rules || {} },
        written: [], curve: { kind: 'none', value: 0 },
        options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2,
          instructions: '', scale: [[90,'A'],[80,'B'],[70,'C'],[0,'F']], footer: '', topsheet: {} },
        createdAt: 1 };
    }

    // ---- plain scoring ----
    let t = mk();
    ok('a correct answer earns the points',
      SC.scoreQuestion(t, 0, 0).earned === 1 && SC.scoreQuestion(t, 0, 0).status === ST.CORRECT);
    ok('a wrong answer earns nothing but still counts against you',
      SC.scoreQuestion(t, 0, 3).earned === 0 && SC.scoreQuestion(t, 0, 3).possible === 1);
    ok('a blank is distinguished from a wrong answer',
      SC.scoreQuestion(t, 0, -1).status === ST.BLANK);
    ok('a double mark is distinguished too',
      SC.scoreQuestion(t, 0, 1, 'multi').status === ST.MULTI);
    ok('an unscanned page is not treated as a wrong answer',
      SC.scoreQuestion(t, 0, -3).status === ST.UNSCANNED);

    // ---- drop ----
    t = mk({ 1: { drop: true } });
    ok('a dropped question is worth nothing to anyone',
      SC.scoreQuestion(t, 1, 1).possible === 0 && SC.scoreQuestion(t, 1, 1).earned === 0);
    ok('dropping lowers the points possible', SC.mcPossible(t) === 3, SC.mcPossible(t));
    const dropped = SC.scoreStudent(t, [0, 9, 2, 3], {}, {});
    ok('dropping a question a student missed raises their percent',
      dropped.total === 3 && dropped.max === 3 && dropped.pct === 1,
      dropped.total + '/' + dropped.max);

    // ---- credit for everyone ----
    t = mk({ 1: { credit: true } });
    ok('credit pays out regardless of the answer',
      SC.scoreQuestion(t, 1, 4).earned === 1 && SC.scoreQuestion(t, 1, 4).status === ST.CREDIT);
    ok('credit still counts toward the total', SC.mcPossible(t) === 4);
    ok('credit even covers a blank', SC.scoreQuestion(t, 1, -1).earned === 1);

    // ---- accept a second answer ----
    t = mk({ 2: { accept: [4] } });
    ok('the original key still scores', SC.scoreQuestion(t, 2, 2).earned === 1);
    ok('the extra accepted answer also scores', SC.scoreQuestion(t, 2, 4).earned === 1);
    ok('other answers still do not', SC.scoreQuestion(t, 2, 1).earned === 0);
    ok('accepted list always contains the key',
      SC.acceptedFor(t, 2).sort().join(',') === '2,4', SC.acceptedFor(t, 2).join(','));

    // ---- per-question points ----
    t = mk({ 0: { points: 5 } }, 2);
    ok('a question can be worth more than the default',
      SC.scoreQuestion(t, 0, 0).earned === 5 && SC.scoreQuestion(t, 1, 1).earned === 2);
    ok('points possible adds up correctly', SC.mcPossible(t) === 11, SC.mcPossible(t));
    ok('a zero-point question scores zero but stays visible',
      SC.scoreQuestion(mk({ 3: { points: 0 } }), 3, 3).possible === 0);

    // ---- rules combine ----
    t = mk({ 0: { accept: [1], points: 3 } });
    ok('accept and points combine', SC.scoreQuestion(t, 0, 1).earned === 3);
    t = mk({ 0: { drop: true, credit: true } });
    ok('drop beats credit when both are set',
      SC.scoreQuestion(t, 0, 4).status === ST.DROPPED && SC.scoreQuestion(t, 0, 4).possible === 0);

    // ---- curves ----
    t = mk(); t.curve = { kind: 'addPercent', value: 10 };
    ok('a percent curve adds percentage points',
      Math.abs(SC.curvedPct(t, 0.5, { max: 4 }) - 0.6) < 1e-9);
    t.curve = { kind: 'addPoints', value: 1 };
    ok('a points curve is relative to the test total',
      Math.abs(SC.curvedPct(t, 0.5, { max: 4 }) - 0.75) < 1e-9);
    t.curve = { kind: 'topIsFull' };
    ok('scaling to the top score lifts everyone proportionally',
      Math.abs(SC.curvedPct(t, 0.4, { topPct: 0.8 }) - 0.5) < 1e-9);
    ok('the top scorer lands on exactly 100%',
      SC.curvedPct(t, 0.8, { topPct: 0.8 }) === 1);
    t.curve = { kind: 'addPercent', value: 50 };
    ok('a curve can never exceed full marks',
      SC.curvedPct(t, 0.9, { max: 4 }) === 1);
    ok('a curve can never go below zero',
      SC.curvedPct(mk(), -1, { max: 4 }) === 0);

    // ================= through the real app =================
    const T = mk({}, 1);
    T.id = 'live'; T.className = 'LiveClass';
    await QG.DB.put('tests', T);
    await QG.DB.putMany('students', [
      { sid: '21', name: 'Ivy Poe', cls: 'LiveClass' },
      { sid: '22', name: 'Jon Ray', cls: 'LiveClass' }
    ]);
    QG.App.State.students = await QG.DB.all('students');
    await QG.App.selectTest(T);
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const files = [];
    // Ivy gets all four right; Jon misses question 2 only.
    for (const [sid, name, ans] of [
      ['21', 'Ivy Poe', { 0: 0, 1: 1, 2: 2, 3: 3 }],
      ['22', 'Jon Ray', { 0: 0, 1: 4, 2: 2, 3: 3 }]
    ]) {
      const sheet = Sy.renderSynthetic(T, 0, { sid, name, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, sid + '.jpg'));
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();
    const row = n => QG.App.State.results.rows.find(r => r.name === n);
    ok('live: scores computed from real scans',
      row('Ivy Poe').total === 4 && row('Jon Ray').total === 3,
      'Ivy ' + row('Ivy Poe').total + ', Jon ' + row('Jon Ray').total);

    // drop the question Jon missed
    const live = QG.App.State.test;
    live.mc.rules = { 1: { drop: true } };
    await QG.DB.put('tests', live);
    QG.App.recompute();
    ok('live: dropping a question rescores the whole class instantly',
      row('Jon Ray').total === 3 && row('Jon Ray').max === 3 && row('Jon Ray').pct === 1,
      'Jon ' + row('Jon Ray').total + '/' + row('Jon Ray').max);
    ok('live: the letter grade follows the new percent',
      row('Jon Ray').letter === 'A', row('Jon Ray').letter);
    ok('live: a dropped question is marked as such per student',
      row('Ivy Poe').qStatus[1] === ST.DROPPED, row('Ivy Poe').qStatus[1]);

    // instead, accept Jon's answer as also correct
    live.mc.rules = { 1: { accept: [4] } };
    await QG.DB.put('tests', live);
    QG.App.recompute();
    ok('live: accepting a second answer gives the points back',
      row('Jon Ray').total === 4 && row('Jon Ray').max === 4,
      row('Jon Ray').total + '/' + row('Jon Ray').max);
    ok('live: item analysis counts the newly accepted answer',
      QG.App.State.results.itemPct[1].correct === 2,
      QG.App.State.results.itemPct[1].correct + ' correct');

    // a curve on top
    live.mc.rules = {};
    live.curve = { kind: 'addPercent', value: 25 };
    await QG.DB.put('tests', live);
    QG.App.recompute();
    ok('live: a curve raises percent without inventing a perfect score',
      Math.abs(row('Jon Ray').pct - 1) < 1e-9 && row('Ivy Poe').pct === 1,
      'Jon ' + row('Jon Ray').pct.toFixed(2));
    ok('live: the uncurved score is kept alongside the curved one',
      Math.abs(row('Jon Ray').rawPct - 0.75) < 1e-9, row('Jon Ray').rawPct);
    live.curve = { kind: 'none', value: 0 };
    await QG.DB.put('tests', live);
    QG.App.recompute();

    // the review screen shows and offers to fix it
    QG.App.route('review');
    await new Promise(r => setTimeout(r, 500));
    ok('review lists every question with how the class did',
      document.querySelectorAll('#questionBox tbody tr').length === 4,
      document.querySelectorAll('#questionBox tbody tr').length + ' rows');
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
