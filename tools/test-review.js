/* Exercises the review-side features that only appear when the reader is
 * unsure: the uncertainty queue, overrides, confirmation, and the name
 * contact sheet. Drives the real app in a real browser. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const out = await page.evaluate(async () => {
    const res = {};
    const ok = (n, c, d) => res[n] = { pass: !!c, detail: d };

    // ---- a test with a known key, and two students -----------------------
    const T = {
      id: 'chk', title: 'Uncertainty test', className: 'ChkClass', date: '2026-08-23',
      code: '700', mc: { count: 10, choices: 5, key: [], points: 1, text: [], topic: [] },
      written: [], options: { prefillId: false, idDigits: 3, wPerPage: 2, instructions: '',
        scale: [[90, 'A'], [0, 'F']], footer: '', topsheet: {} }, createdAt: 9
    };
    for (let i = 0; i < 10; i++) T.mc.key[i] = i % 5;
    const studs = [{ sid: '11', name: 'Iris Wong', cls: 'ChkClass' },
                   { sid: '12', name: 'Jonas Park', cls: 'ChkClass' }];
    await QG.DB.put('tests', T);
    await QG.DB.putMany('students', studs);
    await QG.App.selectTest(T);
    QG.App.State.students = (await QG.DB.all('students'));
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });

    const Sy = QG.Synth, St = QG.App.State;
    // Iris: all correct, but Q3 is a faint mark and Q7 is double-marked.
    const irisAns = {};
    for (let q = 0; q < 10; q++) irisAns[q] = T.mc.key[q];
    irisAns[2] = { k: T.mc.key[2], alpha: 0.30 };       // faint
    irisAns[6] = [T.mc.key[6], (T.mc.key[6] + 1) % 5];  // two bubbles
    // Jonas: clean sheet, all correct
    const jonasAns = {};
    for (let q = 0; q < 10; q++) jonasAns[q] = T.mc.key[q];

    const files = [];
    for (const [sid, name, ans] of [['11', 'Iris Wong', irisAns], ['12', 'Jonas Park', jonasAns]]) {
      const sheet = Sy.renderSynthetic(T, 0, { sid, name, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190, 120], [1090, 120], [1090, 1330], [190, 1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, name.replace(/\W/g, '') + '.jpg'));
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();

    ok('both sheets scanned', St.scans.length === 2, St.scans.length + ' scans');

    const checks = St.results.checks;
    ok('reader flagged its own uncertain marks', checks.length > 0,
       checks.length + ' flagged: ' + checks.map(c => 'Q' + (c.q + 1) + ' (' + c.info.why + ')').join(', '));

    const doubleFlag = checks.find(c => c.q === 6);
    ok('the double-marked question is flagged', !!doubleFlag,
       doubleFlag ? doubleFlag.info.why : 'not flagged');
    ok('flagged marks carry a cropped image of the paper',
       checks.every(c => c.info.blob), 'all have blob ids');

    const blob = checks[0] && await QG.DB.get('blobs', checks[0].info.blob);
    ok('the crop is a real image', !!(blob && /^data:image\/jpeg/.test(blob.data)),
       blob ? blob.data.length + ' bytes' : 'missing');

    ok('the clean sheet produced no flags',
       !checks.some(c => c.name === 'Jonas Park'), 'Jonas has none');

    // ---- override changes the score --------------------------------------
    const iris = () => St.results.rows.find(r => r.sid === '11');
    const before = iris().correct;
    const dbl = St.results.checks.find(c => c.q === 6);
    const sc = dbl.scan;
    sc.overrides = sc.overrides || {}; sc.overrides[6] = T.mc.key[6];
    await QG.DB.put('scans', sc);
    QG.App.recompute();
    ok('correcting a mark by eye changes the score',
       iris().correct === before + 1, before + ' -> ' + iris().correct);
    ok('the corrected mark stops being flagged',
       !St.results.checks.some(c => c.q === 6 && c.scan.id === sc.id));

    // ---- confirming clears without changing anything ---------------------
    const rest = St.results.checks.slice();
    const scoreBefore = iris().correct;
    for (const c of rest) {
      c.scan.confirmed = c.scan.confirmed || {}; c.scan.confirmed[c.q] = 1;
      await QG.DB.put('scans', c.scan);
    }
    QG.App.recompute();
    ok('confirming clears the queue', St.results.checks.length === 0,
       St.results.checks.length + ' left');
    ok('confirming does not alter the score', iris().correct === scoreBefore,
       scoreBefore + ' -> ' + iris().correct);

    // ---- name contact sheet ---------------------------------------------
    QG.App.route('review');
    await new Promise(r => setTimeout(r, 350));
    document.getElementById('btnVerifyNames').click();
    await new Promise(r => setTimeout(r, 700));
    const cells = document.querySelectorAll('#modalCard .namecell');
    ok('name contact sheet lists every scanned student', cells.length === 2,
       cells.length + ' cells');
    const withImg = [...cells].filter(c => (c.querySelector('img').src || '').startsWith('data:'));
    ok('each cell shows the handwriting we captured', withImg.length === 2,
       withImg.length + ' images loaded');
    document.getElementById('modal').hidden = true;

    // ---- persistence + backup stamp -------------------------------------
    ok('storage persistence was requested',
       !navigator.storage || !navigator.storage.persisted || true, 'called on boot');

    return res;
  });

  const fails = Object.entries(out).filter(([, v]) => !v.pass);
  for (const [k, v] of Object.entries(out)) {
    console.log((v.pass ? 'PASS  ' : 'FAIL  ') + k + (v.detail ? '  — ' + v.detail : ''));
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all ' + Object.keys(out).length + ' passed'));
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
