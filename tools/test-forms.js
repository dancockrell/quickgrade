/* Two versions of one test, different question orders, different keys.
 * The QR decides which version a page belongs to. Student ownership is a
 * separate packet/review concern and must not be smuggled back into paper. */
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
    const SC = QG.Scoring, S = QG.Sheet;

    const KEY_A = [0, 1, 2, 3, 4, 0];
    const KEY_B = [4, 3, 2, 1, 0, 4];
    const T = {
      id: 'forms', title: 'Unit 9 Test', className: 'Chem', date: '2026-08-23',
      code: '300', formLabel: 'A',
      mc: { count: 6, choices: 5, key: KEY_A.slice(), points: 1, text: [], topic: [], rules: {} },
      forms: [{ id: 'B', code: '301', key: KEY_B.slice(), rules: {} }],
      written: [], curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[90,'A'],[80,'B'],[70,'C'],[0,'F']], footer: '', topsheet: {} },
      createdAt: 3
    };
    const studs = [
      { sid: '31', name: 'Ada Poe', cls: 'Chem' },
      { sid: '32', name: 'Bo Ling', cls: 'Chem' },
      { sid: '33', name: 'Cy Munro', cls: 'Chem' },
      { sid: '34', name: 'Di Vance', cls: 'Chem' }
    ];
    await QG.DB.put('tests', T);
    await QG.DB.putMany('students', studs);
    QG.App.State.students = await QG.DB.all('students');
    await QG.App.selectTest(T);
    const St = QG.App.State;

    ok('a test knows its versions', SC.formsOf(St.test).length === 2,
      SC.formsOf(St.test).map(f => f.id + ':' + f.code).join(', '));
    ok('version A is the test itself, so nothing needed migrating',
      SC.formsOf(St.test)[0].primary === true && SC.formsOf(St.test)[0].code === '300');
    ok('a sheet is matched to its version by the printed code',
      SC.formByCode(St.test, '301').id === 'B' && SC.formByCode(St.test, '300').id === 'A');
    ok('a code from another test is refused', SC.formByCode(St.test, '742') === null);

    const htmlB = S.renderSheets(St.test, [{}], { form: SC.variantOf(St.test, 'B') });
    ok('version B prints its own code', htmlB.indexOf('301') > 0);
    ok('version B is marked on the paper', /VERSION/.test(htmlB) && htmlB.indexOf('>B<') > 0);
    const htmlA = S.renderSheets(St.test, [{}], { form: SC.variantOf(St.test, 'A') });
    ok('version A stays unmarked, as it always was', htmlA.indexOf('VERSION') < 0);

    const keyB = S.renderSheets(St.test, [{ sid: S.keySid(3), name: 'KEY' }],
      { prefill: true, keyMode: true, form: SC.variantOf(St.test, 'B') });
    const filledB = (keyB.match(/bub fill/g) || []).length;
    const keyA = S.renderSheets(St.test, [{ sid: S.keySid(3), name: 'KEY' }],
      { prefill: true, keyMode: true, form: SC.variantOf(St.test, 'A') });
    ok('each version prints its own answer-key sheet',
      filledB === (keyA.match(/bub fill/g) || []).length && keyA !== keyB,
      filledB + ' bubbles filled on each, but different ones');

    const Sy = QG.Synth;
    const plan = [
      { label: 'Ada', form: 'A', key: KEY_A },
      { label: 'Bo', form: 'B', key: KEY_B },
      { label: 'Cy', form: 'A', key: KEY_A },
      { label: 'Di', form: 'B', key: KEY_B }
    ];
    const order = [1, 0, 3, 2];
    const files = [];
    for (const i of order) {
      const p = plan[i];
      const variant = SC.variantOf(St.test, p.form);
      const ans = {};
      for (let q = 0; q < 6; q++) ans[q] = p.key[q];
      const asPrinted = Object.assign({}, St.test, { code: variant.code });
      const sheet = Sy.renderSynthetic(asPrinted, 0, { sid: '', name: p.label, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, p.label + '.jpg'));
    }
    await QG.Scanner.importFiles(files, { quiet: true });
    QG.App.recompute();

    ok('every sheet in the mixed pile was accepted', St.scans.length === 4,
      St.scans.length + ' of 4');
    ok('new QR sheets remain unassigned rather than inventing roster ownership',
      St.scans.every(s => s.packetUnassigned === true),
      St.scans.map(s => s.sid).join(','));

    const scanForms = St.scans.map(s => s.form || 'A');
    ok('each anonymous packet was filed under the version encoded in its QR',
      scanForms.join(',') === 'B,A,B,A', scanForms.join(','));

    const aRows = St.results.scannedRows.filter(r => r.form === 'A');
    const bRows = St.results.scannedRows.filter(r => r.form === 'B');
    ok('version A packets score against version A key',
      aRows.length === 2 && aRows.every(r => r.correct === 6),
      aRows.map(r => r.correct + '/6').join(', '));
    ok('version B packets score against version B key',
      bRows.length === 2 && bRows.every(r => r.correct === 6),
      bRows.map(r => r.correct + '/6').join(', '));
    ok('scores are comparable across versions',
      St.results.scannedRows.length === 4 && St.results.scannedRows.every(r => r.pct === 1),
      St.results.scannedRows.map(r => r.pct).join(','));

    const wrongWay = SC.scoreStudent(St.test, KEY_B, {}, {}, SC.variantOf(St.test, 'A'));
    ok('a version B sheet scored against key A would be wrong — the versions really differ',
      wrongWay.correct < 6, wrongWay.correct + '/6 if the wrong key were used');

    St.test.forms[0].rules = { 0: { drop: true } };
    await QG.DB.put('tests', St.test);
    QG.App.recompute();
    const aAfter = St.results.scannedRows.filter(r => r.form === 'A');
    const bAfter = St.results.scannedRows.filter(r => r.form === 'B');
    ok('dropping a question on version B leaves version A alone',
      aAfter.every(r => r.max === 6) && bAfter.every(r => r.max === 5),
      'A out of ' + aAfter.map(r => r.max).join('/') + ', B out of ' + bAfter.map(r => r.max).join('/'));
    St.test.forms[0].rules = {};
    await QG.DB.put('tests', St.test);
    QG.App.recompute();

    QG.App.route('review');
    await new Promise(r => setTimeout(r, 500));
    const heads = [...document.querySelectorAll('#reviewTable th')].map(h => h.textContent);
    ok('review gains a version column only because this test has versions',
      heads.includes('Ver'), heads.join('|'));
    QG.App.route('roster');
    await new Promise(r => setTimeout(r, 300));
    const picker = document.getElementById('printForm');
    ok('printing offers a version to print', !picker.hidden && picker.options.length === 2,
      picker.options.length + ' options');
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
