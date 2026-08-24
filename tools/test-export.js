/* The export path a teacher actually uses: pick your gradebook once, press one
 * button, get a file that program will accept. Plus the escape hatches
 * underneath, so nobody is stuck waiting for us to support their software. */
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
    const X2 = QG.ExportMap, S = QG.Sheet;

    const T = { id: 'exp', title: 'Unit 7 Quiz', className: 'Chem A, Chem B', date: '2026-08-23',
      code: '620', mc: { count: 6, choices: 5, key: [0,1,2,3,4,0], points: 1, text: [], topic: [] },
      written: [{ label: 'Why?', max: 4, kind: 'essay', expected: '' }],
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[90,'A'],[80,'B'],[0,'F']], footer: '', topsheet: {} }, createdAt: 7 };
    const studs = [
      { sid: '11', name: 'Ana Ruiz',  cls: 'Chem A', email: 'ana.ruiz@school.org' },
      { sid: '12', name: 'Bo Chen',   cls: 'Chem B', email: 'bo.chen@school.org' },
      { sid: '13', name: 'Cal Ng',    cls: 'Chem A', email: '' }
    ];
    await QG.DB.put('tests', T);
    await QG.DB.putMany('students', studs);
    QG.App.State.students = await QG.DB.all('students');
    await QG.App.selectTest(T);

    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const files = [];
    for (const st of studs.slice(0, 2)) {          // Cal is deliberately not scanned
      const ans = {}; for (let q = 0; q < 6; q++) ans[q] = T.mc.key[q];
      const sheet = Sy.renderSynthetic(T, 0, { sid: st.sid, name: st.name, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, st.sid + '.jpg'));
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();

    const ctx = { test: QG.App.State.test, results: QG.App.State.results, byId: QG.App.State.byId };
    const byId = id => X2.PRESETS.find(p => p.id === id);

    // ---- the one-click default ----
    const simple = X2.buildRows(byId('simple'), ctx, { onlyScanned: true });
    ok('default layout has the three columns a gradebook needs',
      simple.head.join('|') === 'Student|ID|Percent', simple.head.join('|'));
    ok('unscanned students are left out by default',
      simple.rows.length === 2 && !simple.rows.some(r => r[0] === 'Cal Ng'),
      simple.rows.map(r => r[0]).join(', '));
    // 6 of 6 MC right, written question worth 4 not yet graded -> 6/10
    ok('percent comes out as a number, not a string',
      typeof simple.rows[0][2] === 'number' && simple.rows[0][2] === 60, simple.rows[0][2]);

    // ---- LMS layout names its points column after the test ----
    const lms = X2.buildRows(byId('lms'), ctx, { onlyScanned: true });
    ok('LMS layout titles the score column after the test',
      lms.head.includes('Unit 7 Quiz'), lms.head.join('|'));
    ok('LMS layout emits Last, First', lms.rows[0][0] === 'Ruiz, Ana', lms.rows[0][0]);
    ok('email is carried through for Classroom-style imports',
      lms.rows[0][2] === 'ana.ruiz@school.org', lms.rows[0][2]);

    // ---- per-question expansion ----
    const an = X2.buildRows(byId('analysis'), ctx, { onlyScanned: true });
    ok('per-question layout expands to one column per question',
      an.head.filter(h => /^Q\d+$/.test(h)).length === 6, an.head.join('|'));
    ok('answers come out as letters', /^[A-E]$/.test(an.rows[0][3]), an.rows[0].slice(3).join(''));

    // ---- unscanned students CAN be included when wanted ----
    const withAll = X2.buildRows(byId('simple'), ctx, { onlyScanned: false });
    ok('unscanned students can be included on request', withAll.rows.length === 3,
      withAll.rows.length + ' rows');

    // ---- the escape hatch: edit and save a layout ----
    const custom = JSON.parse(JSON.stringify(byId('simple')));
    custom.cols = ['email', 'total', 'letter'];
    custom.heads = { total: 'Score for {{test}}' };
    const cu = X2.buildRows(custom, ctx, { onlyScanned: true });
    ok('columns can be replaced entirely',
      cu.head.join('|') === 'Email|Score for Unit 7 Quiz|Grade', cu.head.join('|'));
    ok('renamed headings substitute the test title',
      cu.head[1].indexOf('Unit 7 Quiz') > 0);

    // ---- endpoint payload is self-describing ----
    const pay = X2.buildPayload(byId('simple'), ctx, { onlyScanned: true });
    ok('endpoint payload identifies itself and carries the data',
      pay.source === 'quickgrade' && pay.version === 1 &&
      pay.test.title === 'Unit 7 Quiz' && pay.columns.length === 3 && pay.rows.length === 2,
      pay.rows.length + ' rows, ' + pay.columns.length + ' cols');
    ok('payload states the points possible', pay.test.pointsPossible === 10,
      String(pay.test.pointsPossible));

    // ---- the UI defaults to simple, with machinery collapsed ----
    QG.App.route('export');
    await new Promise(r => setTimeout(r, 450));
    const adv = document.getElementById('advExport');
    ok('advanced options start collapsed', !adv.open);
    const pick = document.getElementById('fmtPick');
    ok('gradebook picker lists every layout', pick.options.length >= 6,
      pick.options.length + ' options');
    ok('a preview of the real rows is shown',
      document.querySelectorAll('#fmtPreview tbody tr').length > 0,
      document.querySelectorAll('#fmtPreview tbody tr').length + ' preview rows');
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
