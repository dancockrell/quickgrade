/* A student writes their class number once, on page 1, because that is the
 * only place you can count on getting it. Every page after that arrives
 * anonymous, and the app has to work out whose it is from the fact that the
 * papers are scanned as a stack: the last class number scanned owns the pages
 * that follow it, until the next one turns up.
 *
 * That model is only safe if it refuses to guess. This suite exercises the
 * three things that matter: a page that follows page 1 lands in the right
 * file; a page with nobody open is held rather than filed somewhere plausible;
 * and a page that would overwrite one already filed is stopped. The teacher is
 * told whose file each page entered, while the stack is still in their hand. */
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
    const St = QG.App.State, S = QG.Sheet;

    /* two pages of multiple choice so page 2 exists and carries no ID grid */
    const T = { id: 'routing', title: 'Routing test', className: 'M1/1', date: '2026-08-27',
      code: '407',
      mc: { count: 30, choices: 4, key: Array.from({ length: 30 }, (_, i) => i % 4),
            points: 2,
            /* questions printed beside their own bubbles, as the real papers
             * are, because that is the layout the routing has to survive */
            text: Array.from({ length: 30 }, (_, i) => 'Question ' + (i + 1) + ' of the routing test.'),
            topic: [], rules: {} },
      written: [], curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        questionsOnSheet: true, scale: [[0, 'F']], footer: '', topsheet: {} }, createdAt: 5 };
    await QG.DB.put('tests', T);
    await QG.App.selectTest(T);

    const pages = S.layoutTest(T);
    ok('the test really is more than one page', pages.length >= 2, pages.length + ' pages');

    /* two students, so a wrong route has somewhere wrong to go */
    const roster = [{ sid: '101', name: 'Nan Chaiyaphum' }, { sid: '102', name: 'Ploy Sirikul' }];
    for (const r of roster) await QG.DB.put('students', { sid: r.sid, name: r.name, cls: 'M1/1' });
    if (QG.App.reload) await QG.App.reload();

    await new Promise(r => {
      const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r;
      document.head.appendChild(s);
    });
    const Sy = QG.Synth;
    const CAM = { w: 1280, h: 1450, corners: [[190, 120], [1090, 120], [1090, 1330], [190, 1330]],
                  noise: 8, vignette: 0.15 };
    const shot = async (who, pageIdx, tag) => {
      const ans = {};
      pages[pageIdx].mc.forEach(it => { ans[it.q] = T.mc.key[it.q]; });
      const sheet = Sy.renderSynthetic(T, pageIdx, { sid: who.sid, name: who.name, answers: ans });
      return Sy.canvasToFile(Sy.simulateCamera(sheet, CAM), tag + '.jpg');
    };

    /* ---- the sheet itself must not ask twice ---- */
    const holder = document.createElement('div');
    holder.innerHTML = S.renderSheets(T, [{ sid: '101', name: 'Nan Chaiyaphum', cls: 'M1/1' }], {});
    const printed = holder.querySelectorAll('.page');
    const bubbles = Array.from(printed).map(p => p.querySelectorAll('.bub').length);
    ok('page 2 of the printed sheet has no class-number grid',
      printed.length >= 2 && bubbles[1] < bubbles[0],
      'page 1 has ' + bubbles[0] + ' bubbles, page 2 has ' + bubbles[1]);
    ok('page 2 tells the student to keep it with page 1',
      printed.length >= 2 && /page\s*1/i.test(printed[1].textContent),
      printed.length >= 2 ? 'label present' : 'no page 2');

    /* ---- 1. a page with nobody open is held, not filed ---- */
    St.openSid = null;
    await QG.Scanner.importFiles([await shot(roster[0], 1, 'orphan')]);
    QG.App.recompute();
    const orphan = St.scans[St.scans.length - 1];
    ok('a page 2 scanned before any page 1 is not filed to anyone',
      !orphan.sid && (orphan.flags || []).indexOf('no-owner') >= 0,
      'sid=' + orphan.sid + ' flags=' + JSON.stringify(orphan.flags || []));

    /* clear it so the ordered run starts clean */
    St.scans.length = 0; St.openSid = null;

    /* ---- 2. page 1 then page 2, the normal stack ---- */
    await QG.Scanner.importFiles([await shot(roster[0], 0, 'nan1')]);
    QG.App.recompute();
    ok('page 1 identifies its own student',
      S.normId(St.scans[0].sid) === '101', 'sid=' + St.scans[0].sid);
    ok('scanning page 1 opens that student',
      S.normId(St.openSid) === '101', 'open=' + St.openSid);

    await QG.Scanner.importFiles([await shot(roster[0], 1, 'nan2')]);
    QG.App.recompute();
    const p2 = St.scans[St.scans.length - 1];
    ok('page 2 lands in the file page 1 opened',
      S.normId(p2.sid) === '101' && !!p2.routedTo,
      'sid=' + p2.sid + ' routedTo=' + p2.routedTo + ' page=' + p2.page);
    ok('the routed page is marked as routed, not as self-identified',
      !!p2.routedTo && p2.continuation === true,
      'routedTo=' + p2.routedTo + ' continuation=' + p2.continuation);

    /* ---- 3. the next page 1 moves the open file ---- */
    await QG.Scanner.importFiles([await shot(roster[1], 0, 'ploy1')]);
    QG.App.recompute();
    ok('the next page 1 takes over as the open file',
      S.normId(St.openSid) === '102', 'open=' + St.openSid);
    await QG.Scanner.importFiles([await shot(roster[1], 1, 'ploy2')]);
    QG.App.recompute();
    const q2 = St.scans[St.scans.length - 1];
    ok('the second page 2 goes to the second student, not the first',
      S.normId(q2.sid) === '102', 'sid=' + q2.sid);

    /* ---- 4. a page already filed is refused, not silently overwritten ---- */
    await QG.Scanner.importFiles([await shot(roster[1], 1, 'ploy2again')]);
    QG.App.recompute();
    const dup = St.scans[St.scans.length - 1];
    ok('a second page 2 for the open student is stopped',
      (dup.flags || []).indexOf('owner-clash') >= 0 && !dup.routedTo,
      'flags=' + JSON.stringify(dup.flags || []) + ' routedTo=' + dup.routedTo);
    const filedTwice = St.scans.filter(s =>
      S.normId(s.sid) === '102' && s.page === 2 && s.routedTo).length;
    ok('the student still has exactly one page 2', filedTwice === 1, filedTwice + ' filed');

    /* the first student's two pages are still together under one name */
    const marked = St.scans.filter(s => S.normId(s.sid) === '101');
    ok('both of the first student pages are under one name',
      marked.length === 2 && marked.map(s => s.page).sort().join(',') === '1,2',
      marked.length + ' pages: ' + marked.map(s => s.page).join(','));

    /* ---- 5. an unreadable page 1 must close the open file, not leave the
     * previous student holding it open.
     *
     * A page 1 that cannot be read means a new student has started and nobody
     * knows who. That is the moment the previous student's file has to close:
     * if it stays open, the next anonymous page is aimed at the wrong child
     * and lands there quietly, announced by name as though it were right.
     * The sample class hits this every time - one sheet in it has a
     * deliberately unreadable class number - and it only showed up as a clash
     * because the previous student already had that page. Given room, it
     * misfiles instead of complaining. */
    St.scans.length = 0; St.openSid = null; St.openFor = null;

    /* a student with page 1 only, so there is room for someone else's page 2 */
    await QG.Scanner.importFiles([await shot(roster[0], 0, 'nan-alone')]);
    QG.App.recompute();
    ok('a student is open with room for a page 2',
      S.normId(St.openSid) === '101', 'open=' + St.openSid);

    /* the next student's page 1, with no class number filled in at all */
    await QG.Scanner.importFiles([await shot({ sid: null, name: 'Unreadable' }, 0, 'smudged')]);
    QG.App.recompute();
    const smudged = St.scans[St.scans.length - 1];
    ok('a page 1 with no readable class number is not filed',
      !smudged.sid, 'sid=' + smudged.sid + ' flags=' + JSON.stringify(smudged.flags || []));
    ok('an unreadable page 1 closes the open file rather than leaving it open',
      !St.openSid, 'open=' + St.openSid);

    /* that student's page 2 must be held, not posted to the student before */
    await QG.Scanner.importFiles([await shot({ sid: null, name: 'Unreadable' }, 1, 'smudged2')]);
    QG.App.recompute();
    const stray = St.scans[St.scans.length - 1];
    ok('the page after an unreadable page 1 is held, not filed to the student before',
      !stray.routedTo && S.normId(stray.sid || '') !== '101',
      'sid=' + stray.sid + ' routedTo=' + stray.routedTo +
      ' flags=' + JSON.stringify(stray.flags || []));
    const nanPages = St.scans.filter(s => S.normId(s.sid) === '101').length;
    ok('the earlier student did not silently gain a page',
      nanPages === 1, nanPages + ' pages under the earlier student');

    /* ---- 5b. the same thing, with the previous student already complete.
     *
     * This is the shape the sample class actually produces: a student who
     * holds both their pages, then a sheet whose class number cannot be read,
     * then that student's page 2. It is worth its own case because the guard
     * that catches the misfile here is a different one - the previous student
     * has no room, so a stale open file shows up as a clash rather than as a
     * silent filing - and a clash tells the teacher to rescan a class number
     * that was never readable, which is advice that cannot work. */
    St.scans.length = 0; St.openSid = null; St.openFor = null;
    await QG.Scanner.importFiles([await shot(roster[0], 0, 'complete1')]);
    await QG.Scanner.importFiles([await shot(roster[0], 1, 'complete2')]);
    QG.App.recompute();
    ok('the previous student holds both pages',
      St.scans.filter(s => S.normId(s.sid) === '101').length === 2,
      St.scans.filter(s => S.normId(s.sid) === '101').length + ' pages');

    await QG.Scanner.importFiles([await shot({ sid: null, name: 'Unreadable' }, 0, 'smudgedB')]);
    QG.App.recompute();
    ok('the unreadable page 1 closed the file even though the previous student was complete',
      !St.openSid, 'open=' + St.openSid);

    await QG.Scanner.importFiles([await shot({ sid: null, name: 'Unreadable' }, 1, 'smudgedB2')]);
    QG.App.recompute();
    const orphanB = St.scans[St.scans.length - 1];
    ok('its page 2 is held as having no owner, not reported as a clash',
      (orphanB.flags || []).indexOf('no-owner') >= 0 &&
      (orphanB.flags || []).indexOf('owner-clash') < 0,
      'flags=' + JSON.stringify(orphanB.flags || []));

    /* ---- 6. the teacher is told, in words, whose file it went into ---- */
    const line = QG.I18N.t('scan.filedInto', { name: 'Ploy Sirikul', n: 2 });
    ok('the confirmation names the student and the page',
      line.indexOf('Ploy Sirikul') >= 0 && line.indexOf('2') >= 0 && line.indexOf('{') < 0,
      JSON.stringify(line));

    return res;
  });

  let failed = 0;
  for (const [name, r] of Object.entries(out)) {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + name + (r.d ? '  — ' + r.d : ''));
  }
  if (errs.length) {
    console.log('\n  page errors:');
    errs.forEach(e => console.log('   ' + e));
    failed += errs.length;
  }
  console.log('\n' + (failed ? failed + ' problem(s)' : 'all clear'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
