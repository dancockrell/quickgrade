/* Deleting scans must be recoverable, and creating a class must not require
 * a separate step. Both are about a teacher not losing work or momentum. */
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
    const St = QG.App.State;

    // ---- a class exists the moment you name it ----
    QG.App.route('roster');
    await new Promise(r => setTimeout(r, 250));
    const cls = document.getElementById('rosterClass');
    ok('class field is a plain text box, not a dropdown',
      cls.tagName === 'INPUT', cls.tagName);
    ok('there is no separate "new class" step',
      !document.getElementById('btnNewClass'));
    cls.value = 'Physics P2';
    cls.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('rosterPaste').value = 'Ada Byron\nGrace Hopper\nAlan Turing';
    document.getElementById('btnRosterSave').click();
    await new Promise(r => setTimeout(r, 700));
    const added = St.students.filter(s => s.cls === 'Physics P2');
    ok('typing a class name and pasting names is enough',
      added.length === 3, added.length + ' students in a class that did not exist');
    ok('existing classes are still offered as suggestions',
      document.querySelectorAll('#classChoices option').length > 0,
      document.querySelectorAll('#classChoices option').length + ' suggestions');

    // ---- set up a test with scans so there is something to delete ----
    const T = { id: 'undo', title: 'Undo test', className: 'Physics P2', date: '2026-08-23',
      code: '808', mc: { count: 5, choices: 5, key: [0,1,2,3,4], points: 1, text: [], topic: [], rules: {} },
      written: [], curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[0,'F']], footer: '', topsheet: {} }, createdAt: 4 };
    await QG.DB.put('tests', T);
    await QG.App.selectTest(T);
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const files = [];
    for (const st of added.slice(0, 3)) {
      const ans = {}; for (let q = 0; q < 5; q++) ans[q] = T.mc.key[q];
      const sheet = Sy.renderSynthetic(T, 0, { sid: st.sid, name: st.name, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
        corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
      files.push(await Sy.canvasToFile(photo, st.sid + '.jpg'));
    }
    await QG.Scanner.importFiles(files);
    QG.App.recompute();
    ok('three sheets scanned to work with', St.scans.length === 3, St.scans.length + ' scans');
    const blobBefore = (await QG.DB.all('blobs')).length;

    // ---- delete one, bring it back ----
    const victim = St.scans[0];
    const vId = victim.id;
    await QG.App.__test.deleteScan(victim);
    ok('a deleted scan leaves the active list', St.scans.length === 2, St.scans.length);
    ok('it goes to the trash rather than vanishing',
      St.trash.length === 1 && St.trash[0].id === vId, St.trash.length + ' in trash');
    ok('its images are NOT destroyed on delete',
      (await QG.DB.all('blobs')).length === blobBefore,
      'blobs still ' + (await QG.DB.all('blobs')).length);
    ok('the student now reads as missing a page',
      QG.App.State.results.rows.some(r => r.scanned === false || r.missing.length),
      'reflected in results');

    await QG.App.__test.restoreScans([victim]);
    ok('restoring puts the scan back', St.scans.length === 3 && St.trash.length === 0,
      St.scans.length + ' active, ' + St.trash.length + ' trashed');
    ok('the restored scan is scored again',
      QG.App.State.results.scannedRows.length === 3,
      QG.App.State.results.scannedRows.length + ' scanned students');

    // ---- deletions survive a reload, still recoverable ----
    await QG.App.__test.deleteScan(St.scans[0]);
    await QG.App.selectTest(QG.App.State.test);
    ok('a deletion survives reloading the test, still in the trash',
      St.scans.length === 2 && St.trash.length === 1,
      St.scans.length + ' active, ' + St.trash.length + ' trashed');

    // ---- the trash is visible and offers to undo ----
    QG.App.route('review');
    await new Promise(r => setTimeout(r, 400));
    const bar = document.querySelector('#trashBox .trashbar');
    ok('review shows a recoverable-deletions bar', !!bar,
      bar ? bar.textContent.slice(0, 46) : 'missing');
    const back = [...document.querySelectorAll('#trashBox button')]
      .find(b => /bring them back/i.test(b.textContent));
    ok('the bar offers to bring them back', !!back);
    back.click();
    await new Promise(r => setTimeout(r, 500));
    ok('clicking it restores everything', St.scans.length === 3 && St.trash.length === 0,
      St.scans.length + ' active');

    // ---- permanent delete really is permanent ----
    await QG.App.__test.deleteScan(St.scans[0]);
    await QG.App.__test.purgeScans(St.trash.slice());
    ok('emptying the trash removes the scan for good',
      St.trash.length === 0 && St.scans.length === 2, St.scans.length + ' active');
    ok('emptying the trash also reclaims the images',
      (await QG.DB.all('blobs')).length < blobBefore,
      (await QG.DB.all('blobs')).length + ' blobs, was ' + blobBefore);
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
