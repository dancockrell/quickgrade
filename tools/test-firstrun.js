/* A teacher's first minute: an empty app must hand them one thing to do and
 * end with a printable sheet. Also covers reclaiming image storage. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const out = await page.evaluate(async () => {
    const res = {}; const ok = (n, c, d) => res[n] = { pass: !!c, d };
    const St = QG.App.State;

    // a genuinely empty install
    ok('starts with no tests', St.tests.length === 0, St.tests.length + ' tests');
    QG.App.route('tests');
    await new Promise(r => setTimeout(r, 300));

    const panel = document.querySelector('.firstrun');
    ok('an empty app offers a guided start, not a blank screen', !!panel);
    ok('it asks three questions and no more',
      document.querySelectorAll('.firstrun .steps li').length === 3,
      document.querySelectorAll('.firstrun .steps li').length + ' steps');
    ok('it says where the data lives',
      /stays on this computer/i.test(panel.textContent));

    const [title, cls] = panel.querySelectorAll('input');
    const key = panel.querySelector('textarea');
    const go = [...panel.querySelectorAll('button')].find(b => /make my answer sheet/i.test(b.textContent));
    ok('the main action starts disabled', go.disabled);

    // fill it in the way a teacher would
    title.value = 'Unit 4 — Cell Biology';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    cls.value = 'Biology P3';
    cls.dispatchEvent(new Event('input', { bubbles: true }));
    ok('still disabled without a key', go.disabled);

    key.value = 'nonsense that is not a key at all';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    ok('an unreadable key is refused, not guessed', go.disabled,
      panel.textContent.indexOf('Can’t read') > 0 ? 'and it says so' : 'silently');

    key.value = '1. What powers the cell? B\n2. Which folds protein? C\n3. Name the nucleus part A\n4. Control centre? D\n5. Stores water? E';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    ok('a readable key enables the action', !go.disabled);
    ok('it reports what it read back',
      /5 answers/.test(panel.textContent), (panel.textContent.match(/\d+ answers[^,]*,[^.]*/) || [''])[0].trim());

    // printing opens a window; stub it so the test stays headless
    let printed = null;
    window.open = function (u, n) {
      printed = { opened: true };
      return { document: { open() {}, write(h) { printed.html = h; }, close() {} },
               focus() {}, print() {} };
    };
    go.click();
    await new Promise(r => setTimeout(r, 900));

    const t = St.test;
    ok('a test now exists and is selected', !!t && t.title === 'Unit 4 — Cell Biology',
      t && t.title);
    ok('the class came across', (t.classes || [])[0] === 'Biology P3', (t.classes || [])[0]);
    ok('the key was applied', JSON.stringify(t.mc.key) === '[1,2,0,3,4]', JSON.stringify(t.mc.key));
    ok('the question count was worked out', t.mc.count === 5, t.mc.count);
    ok('the number of choices was worked out', t.mc.choices === 5, t.mc.choices);
    ok('question wording was kept from the paste',
      (t.mc.text || [])[0] === 'What powers the cell?', JSON.stringify((t.mc.text || [])[0]));

    ok('it went straight to a printable sheet', !!(printed && printed.opened));
    ok('the sheet is a real answer sheet',
      !!printed.html && printed.html.indexOf('class="page"') > 0 &&
      printed.html.indexOf('Unit 4') > 0,
      printed.html ? printed.html.length + ' bytes of HTML' : 'nothing');

    ok('the guided panel is replaced by the normal screen',
      !document.querySelector('.firstrun'));
    ok('the next-step strip now takes over',
      document.querySelectorAll('#workflow .step').length > 0,
      document.querySelectorAll('#workflow .step').length + ' steps');

    // ---------------- storage upkeep ----------------
    await QG.DB.putMany('students', [{ sid: '1', name: 'Ann Lee', cls: 'Biology P3' }]);
    St.students = await QG.DB.all('students');
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const sheet = Sy.renderSynthetic(t, 0, { sid: '1', name: 'Ann Lee', answers: { 0:1,1:2,2:0,3:3,4:4 } });
    const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
      corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
    await QG.Scanner.importFiles([await Sy.canvasToFile(photo, 'a.jpg')]);
    QG.App.recompute();
    const blobsBefore = (await QG.DB.all('blobs')).length;
    ok('scanning stored some images', blobsBefore > 0, blobsBefore + ' images');

    QG.App.route('review');
    await new Promise(r => setTimeout(r, 900));
    const free = [...document.querySelectorAll('#storageBox button')]
      .find(b => /free up/i.test(b.textContent));
    ok('review offers to reclaim the image space', !!free,
      document.querySelector('#storageBox') ? document.querySelector('#storageBox').textContent.slice(0, 60) : '');

    const scoreBefore = St.results.rows.find(r => r.sid === '1').total;
    await QG.DB.delMany('blobs', (function () {
      var ids = []; St.scans.forEach(function (sc) {
        if (sc.nameCrop) ids.push(sc.nameCrop);
        if (sc.classCrop) ids.push(sc.classCrop);
        if (sc.pageImg) ids.push(sc.pageImg);
      }); return ids;
    })());
    QG.App.recompute();
    ok('scores survive losing the images',
      St.results.rows.find(r => r.sid === '1').total === scoreBefore,
      scoreBefore + ' -> ' + St.results.rows.find(r => r.sid === '1').total);
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
