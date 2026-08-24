/* Screenshots every QuickGrade screen, with realistic demo data seeded first,
 * so the design can be judged on how it looks full rather than empty. */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';
const OUT = __dirname;
const THEME = process.env.QG_THEME || 'light';
const W = +(process.env.QG_W || 1440), H = +(process.env.QG_H || 900);
const TAG = process.env.QG_TAG || THEME;

const SEED = async (page) => page.evaluate(async () => {
  const T = {
    id: 'demo', title: 'Unit 4 — Cell Biology', className: 'Biology P3',
    date: '2026-08-23', code: '042',
    mc: { count: 24, choices: 5, key: [], points: 1, text: [], topic: [] },
    written: [
      { label: 'Explain osmosis in your own words.', max: 5, kind: 'essay', expected: '' },
      { label: 'Name three organelles and their jobs.', max: 6, kind: 'short', expected: '' }
    ],
    options: { prefillId: true, wPerPage: 2, instructions: 'Use pencil.',
      scale: [[90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [0, 'F']],
      footer: 'Corrections due Friday for half credit back.', topsheet: {} },
    createdAt: 3
  };
  for (let i = 0; i < 24; i++) { T.mc.key[i] = (i * 3) % 5; T.mc.topic[i] = ['Cells', 'Transport', 'Energy'][i % 3]; }
  const T2 = Object.assign({}, JSON.parse(JSON.stringify(T)), {
    id: 'demo2', title: 'Unit 3 — Photosynthesis', code: '018', createdAt: 2,
    written: [], mc: Object.assign({}, T.mc, { count: 40 })
  });
  const T3 = Object.assign({}, JSON.parse(JSON.stringify(T)), {
    id: 'demo3', title: 'Midterm Review Quiz', className: 'Biology P5',
    code: '205', createdAt: 1, written: [], mc: Object.assign({}, T.mc, { count: 12 })
  });
  const names = ['Avery Nguyen', 'Ben Carter', 'Chloe Diaz', 'Diego Ruiz',
                 'Emma Sullivan', 'Farid Haddad', 'Grace Okonkwo', 'Hana Ito'];
  const studs = names.map((n, i) => ({ sid: String(100041 + i), name: n, cls: 'Biology P3' }));
  await QG.DB.put('tests', T); await QG.DB.put('tests', T2); await QG.DB.put('tests', T3);
  await QG.DB.putMany('students', studs);
  localStorage.setItem('qg.testId', JSON.stringify('demo'));
  localStorage.setItem('qg.view', JSON.stringify('tests'));
});

const SCAN = async (page) => page.evaluate(async () => {
  await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
  const St = QG.App.State, T = St.test, Sy = QG.Synth;
  const roster = St.students.filter(s => s.cls === T.className);
  const files = [];
  const CASES = [
    { corners: [[250, 190], [1060, 118], [1128, 1290], [176, 1218]], noise: 14, vignette: .4 },
    { corners: [[190, 120], [1090, 120], [1090, 1330], [190, 1330]], noise: 8, vignette: .15 },
    { corners: [[168, 262], [980, 132], [1160, 1240], [232, 1352]], noise: 12, vignette: .48 }
  ];
  for (let i = 0; i < roster.length; i++) {
    const ans = {};
    for (let q = 0; q < T.mc.count; q++) ans[q] = (q % (i + 2) === 0) ? (T.mc.key[q] + 1) % 5 : T.mc.key[q];
    if (i === 3) ans[5] = -1;
    for (let pg = 0; pg < St.pages.length; pg++) {
      if (i === 6 && pg === 1) continue;                    // one student missing a page
      const sid = i === 7 ? '' : roster[i].sid;             // one sheet with no ID bubbled
      const sheet = Sy.renderSynthetic(T, pg, { sid, name: roster[i].name, answers: ans });
      const photo = Sy.simulateCamera(sheet, Object.assign({ w: 1280, h: 1450 }, CASES[i % 3]));
      files.push(await Sy.canvasToFile(photo, 's' + i + 'p' + pg + '.jpg'));
    }
  }
  await QG.Scanner.importFiles(files);
  // grade some written answers so the Grade and Export screens have real content
  QG.App.recompute();
  St.results.rows.forEach((x, i) => {
    if (!x.scanned || i > 4) return;
    const g = St.grades[x.sid] || (St.grades[x.sid] = {}); g.w = g.w || {};
    T.written.forEach((wq, wi) => { g.w[wi] = { p: Math.max(0, (wq.max || 0) - i), c: wi === 0 && i === 0 ? 'Clear and complete.' : '' }; });
  });
  await QG.DB.put('kv', { k: 'grades:' + T.id, v: St.grades });
  QG.App.recompute();
  return St.scans.length;
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, colorScheme: THEME, deviceScaleFactor: 2
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await SEED(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const shots = [];
  async function shot(name) {
    const f = path.join(OUT, `${TAG}-${name}.png`);
    await page.screenshot({ path: f });
    shots.push(name);
  }

  await page.evaluate(() => QG.App.route('tests'));
  await page.waitForTimeout(350);
  await shot('1-tests');

  await page.evaluate(() => { QG.App.route('tests'); document.getElementById('btnNewTest').click(); });
  await page.waitForTimeout(400);
  await shot('2-editor');

  await page.evaluate(() => { document.getElementById('btnCancelTest').click(); QG.App.route('roster'); });
  await page.waitForTimeout(350);
  await shot('3-roster');

  const n = await SCAN(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => QG.App.route('review'));
  await page.waitForTimeout(500);
  await shot('4-review');

  await page.evaluate(() => QG.App.route('written'));
  await page.waitForTimeout(700);
  await shot('5-grade');

  await page.evaluate(() => QG.App.route('export'));
  await page.waitForTimeout(400);
  await shot('6-export');

  await page.evaluate(() => QG.App.route('scan'));
  await page.waitForTimeout(400);
  await shot('7-scan');

  // the printable answer sheet, rendered as the printer would emit it
  const sheetHtml = await page.evaluate(() => {
    const St = QG.App.State;
    return QG.Sheet.renderSheets(St.test,
      [{ sid: '100041', name: 'Avery Nguyen', cls: St.test.className }], { prefill: true });
  });
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 900, height: 1180 });
  await p2.setContent(sheetHtml, { waitUntil: 'load' });
  await p2.addStyleTag({ content: '.toolbar{display:none!important} body{background:#fff}' });
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: path.join(OUT, `${TAG}-8-answersheet.png`), clip: { x: 0, y: 0, width: 830, height: 1080 } });
  shots.push('8-answersheet');

  console.log(JSON.stringify({ scans: n, shots, errors }, null, 1));
  await browser.close();
})();
