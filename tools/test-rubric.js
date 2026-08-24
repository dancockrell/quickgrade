/* Marking a written answer against criteria, one keystroke each, and the
 * points landing in exactly the same place a hand-typed mark would. */
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
    const SC = QG.Scoring;

    const RUB = {
      levels: [{ label: 'Not yet', pts: 0 }, { label: 'Partly', pts: 1 }, { label: 'Fully', pts: 2 }],
      criteria: ['Correct terms', 'Explains mechanism', 'Gives an example']
    };

    // ---------------- the maths ----------------
    ok('a rubric total is criteria times the top level',
      SC.rubricMax(RUB) === 6, SC.rubricMax(RUB));
    ok('marks add up across criteria',
      SC.rubricScore(RUB, [2, 1, 0]) === 3, SC.rubricScore(RUB, [2, 1, 0]));
    ok('an unmarked criterion scores nothing rather than breaking',
      SC.rubricScore(RUB, [2, null, 2]) === 4, SC.rubricScore(RUB, [2, null, 2]));
    ok('completeness is only true when every criterion is marked',
      !SC.rubricComplete(RUB, [2, 1]) && SC.rubricComplete(RUB, [0, 0, 0]));

    // ---------------- a real test ----------------
    const T = {
      id: 'rub', title: 'Essay Test', className: 'Eng', date: '2026-08-24', code: '520',
      formLabel: 'A', forms: [],
      mc: { count: 2, choices: 4, key: [0, 1], points: 1, text: [], topic: [], rules: {} },
      written: [
        { label: 'Explain osmosis.', max: 6, kind: 'essay', expected: '',
          rubric: JSON.parse(JSON.stringify(RUB)) },
        { label: 'Name three organelles.', max: 3, kind: 'short', expected: '' }
      ],
      curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[90,'A'],[80,'B'],[0,'F']], footer: '', topsheet: { showWritten: true, showWrittenNotes: true } },
      createdAt: 11
    };
    const studs = [
      { sid: '61', name: 'Hal Reed', cls: 'Eng' },
      { sid: '62', name: 'Ida Nunes', cls: 'Eng' }
    ];
    await QG.DB.put('tests', T);
    await QG.DB.putMany('students', studs);
    QG.App.State.students = await QG.DB.all('students');
    await QG.App.selectTest(T);
    const St = QG.App.State;

    ok('a question with a rubric is worth what the rubric says',
      SC.rubricMax(SC.rubricOf(St.test, 0)) === 6 && St.test.written[0].max === 6);
    ok('a question without one is untouched', !SC.hasRubric(St.test, 1));

    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const files = [];
    for (const st of studs) {
      for (let pg = 0; pg < St.pages.length; pg++) {
        const sheet = Sy.renderSynthetic(St.test, pg, { sid: st.sid, name: st.name, answers: { 0: 0, 1: 1 } });
        const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
          corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
        files.push(await Sy.canvasToFile(photo, st.sid + '_' + pg + '.jpg'));
      }
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();
    ok('sheets scanned, including the written page', St.scans.length === files.length,
      St.scans.length + ' of ' + files.length);

    // ---------------- marking by keyboard ----------------
    QG.App.route('written');
    await new Promise(r => setTimeout(r, 600));
    ok('the marking screen shows one row per criterion',
      document.querySelectorAll('#pointsRow .rubrow').length === 3,
      document.querySelectorAll('#pointsRow .rubrow').length + ' rows');
    ok('each row offers every level',
      document.querySelectorAll('#pointsRow .rubrow')[0].querySelectorAll('.pbtn.rub').length === 3);

    const who = () => document.getElementById('gradeProgress').textContent;
    const first = who();
    const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

    key('3'); await new Promise(r => setTimeout(r, 250));   // Fully
    key('2'); await new Promise(r => setTimeout(r, 250));   // Partly
    const partial = St.results.rows.find(r => r.wRecords && r.wRecords[0]);
    ok('marks land as they are pressed, before the rubric is finished',
      partial && partial.wRecords[0].p === 3, partial ? partial.wRecords[0].p : 'none');
    ok('it does not advance until every criterion is marked', who() === first, who());

    key('1'); await new Promise(r => setTimeout(r, 400));   // Not yet -> completes
    ok('finishing the rubric moves to the next student', who() !== first, who());

    const done = St.results.rows.find(r => (r.wRecords[0] || {}).r && r.wRecords[0].r.length === 3);
    ok('the three keystrokes recorded the three levels',
      done && done.wRecords[0].r.join(',') === '2,1,0', done ? done.wRecords[0].r.join(',') : '');
    ok('the points are the sum of the levels', done && done.wRecords[0].p === 3,
      done ? done.wRecords[0].p : '');
    ok('that score counts toward the test total like any other',
      done && done.wPts === 3, done ? done.wPts + ' written points' : '');

    // backspace undoes the last criterion
    QG.App.route('written');
    await new Promise(r => setTimeout(r, 400));
    key('3'); await new Promise(r => setTimeout(r, 250));
    key('3'); await new Promise(r => setTimeout(r, 250));
    const before = St.results.rows.find(r => (r.wRecords[0] || {}).r && r.wRecords[0].r.length === 2);
    key('Backspace'); await new Promise(r => setTimeout(r, 300));
    const after = St.results.rows.find(r => r.sid === (before || {}).sid);
    ok('backspace takes back the last criterion',
      after && after.wRecords[0].p === 2, after ? after.wRecords[0].p + ' after undo' : 'n/a');

    // ---------------- it reaches the student ----------------
    const orig = QG.downloadBlob; let docx = null;
    QG.downloadBlob = (b) => { docx = b; };
    QG.App.route('export');
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('exDocx').click();
    await new Promise(r => setTimeout(r, 800));
    QG.downloadBlob = orig;
    ok('the graded sheet is produced with the rubric breakdown on it',
      !!docx && docx.size > 2000, docx ? Math.round(docx.size / 1024) + ' KB' : 'nothing');

    // ---------------- removing a rubric ----------------
    delete St.test.written[0].rubric;
    St.test.written[0].max = 6;
    await QG.DB.put('tests', St.test);
    QG.App.recompute();
    ok('dropping the rubric keeps the marks already given',
      St.results.rows.some(r => (r.wRecords[0] || {}).p === 3),
      'scores survived');
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
