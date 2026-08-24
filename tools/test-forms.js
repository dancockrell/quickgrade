/* Two versions of one test, different question orders, different keys.
 * The whole point is that a teacher feeds in a shuffled pile and never has to
 * say which sheet is which — the printed code decides. */
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

    // Version A: key A B C D E.  Version B: the same six questions, reordered.
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

    // ---- the model ----
    ok('a test knows its versions', SC.formsOf(St.test).length === 2,
      SC.formsOf(St.test).map(f => f.id + ':' + f.code).join(', '));
    ok('version A is the test itself, so nothing needed migrating',
      SC.formsOf(St.test)[0].primary === true && SC.formsOf(St.test)[0].code === '300');
    ok('a sheet is matched to its version by the printed code',
      SC.formByCode(St.test, '301').id === 'B' && SC.formByCode(St.test, '300').id === 'A');
    ok('a code from another test is refused', SC.formByCode(St.test, '742') === null);

    // ---- print ----
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

    // ---- scan a shuffled pile ----
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const pages = S.layoutTest(St.test);
    // Ada and Cy sat version A and got everything right.
    // Bo and Di sat version B and got everything right.
    const plan = [
      { sid: '31', form: 'A', key: KEY_A },
      { sid: '32', form: 'B', key: KEY_B },
      { sid: '33', form: 'A', key: KEY_A },
      { sid: '34', form: 'B', key: KEY_B }
    ];
    // deliberately interleave the versions
    const order = [1, 0, 3, 2];
    const files = [];
    for (const i of order) {
      const p = plan[i];
      const variant = SC.variantOf(St.test, p.form);
      const ans = {};
      for (let q = 0; q < 6; q++) ans[q] = p.key[q];
      // the sheet must carry the version's own code
      const asPrinted = Object.assign({}, St.test, { code: variant.code });
      const sheet = Sy.renderSynthetic(asPrinted, 0, { sid: p.sid, name: p.sid, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, p.sid + '.jpg'));
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();

    ok('every sheet in the mixed pile was accepted', St.scans.length === 4,
      St.scans.length + ' of 4');
    const byName = n => St.results.rows.find(r => r.name === n);
    ok('each sheet was filed under the version it was printed as',
      byName('Ada Poe').form === 'A' && byName('Bo Ling').form === 'B' &&
      byName('Cy Munro').form === 'A' && byName('Di Vance').form === 'B',
      ['Ada Poe','Bo Ling','Cy Munro','Di Vance'].map(n => n[0] + ':' + byName(n).form).join(' '));

    ok('version A students scored against the version A key',
      byName('Ada Poe').correct === 6 && byName('Cy Munro').correct === 6,
      'Ada ' + byName('Ada Poe').correct + '/6, Cy ' + byName('Cy Munro').correct + '/6');
    ok('version B students scored against the version B key',
      byName('Bo Ling').correct === 6 && byName('Di Vance').correct === 6,
      'Bo ' + byName('Bo Ling').correct + '/6, Di ' + byName('Di Vance').correct + '/6');
    ok('scores are comparable across versions',
      St.results.scannedRows.every(r => r.pct === 1), 'all four at 100%');

    // the crucial negative: version B answers must NOT score against key A
    const wrongWay = SC.scoreStudent(St.test, KEY_B, {}, {}, SC.variantOf(St.test, 'A'));
    ok('a version B sheet scored against key A would be wrong — the versions really differ',
      wrongWay.correct < 6, wrongWay.correct + '/6 if the wrong key were used');

    // ---- a per-version rule only touches that version ----
    St.test.forms[0].rules = { 0: { drop: true } };
    await QG.DB.put('tests', St.test);
    QG.App.recompute();
    ok('dropping a question on version B leaves version A alone',
      byName('Ada Poe').max === 6 && byName('Bo Ling').max === 5,
      'A out of ' + byName('Ada Poe').max + ', B out of ' + byName('Bo Ling').max);
    St.test.forms[0].rules = {};
    await QG.DB.put('tests', St.test);
    QG.App.recompute();

    // ---- it shows up where a teacher would look ----
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
